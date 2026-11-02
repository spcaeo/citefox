import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import { createLimiter, type Limiter } from '../../engine/checks/check-pace'
import { rollupSamples } from '../../engine/checks/score'
import { settleEach } from '../../engine/parallel'
import { llmInputHash } from '../../pipeline/hash'
import { completeStructured, type GenerationCallCaps } from '../../pipeline/llm'
import { loadGenerationTemplate, renderTemplate } from '../../pipeline/templates'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { getAnswerShapes, saveAnswerShape } from '../../storage/answer-shapes'
import {
  listStoredCheckRuns,
  listStoredMarketPrompts,
  listStoredSerpResults,
  type StoredSerpResult
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { ANSWER_SHAPE_SCHEMA, answerShapeBlocks, answerShapeSchemaError } from './schema'
import { overviewHash } from './vocabulary'

export interface ClassifyRunAnswerShapesInput {
  /** The project database: the run's stored overviews and the `answer_shapes` cache. */
  db: SqliteDatabase
  /** The app database: the default `answer_shape` template (a project version wins). */
  appDb: SqliteDatabase
  projectId: string
  runId: string
  claude: ClaudeProvider
  logger: Logger
  secrets?: readonly string[]
  /** Same daily and monthly caps as `completeStructured`. Omit for the shared default. */
  caps?: GenerationCallCaps
  /** Checked before each Claude call. True stops the step: no further call is made. */
  shouldStop?: () => boolean
  now?: () => string
  /**
   * Overviews are classified through this limiter, side by side up to its size (the
   * report runner shares one per job). Omitted: one at a time.
   */
  limiter?: Limiter
}

export interface ClassifyRunAnswerShapesResult {
  /** Overviews Claude classified in this call and that were saved. */
  classified: number
  /** Prompts whose overview text was already classified. No Claude call was made. */
  cached: number
  /** Prompts with no overview text, and overviews whose classification failed. */
  skipped: number
  /** True when `shouldStop` ended the step before every overview was classified. */
  stopped: boolean
}

interface PendingOverview {
  hash: string
  promptText: string
  overviewText: string
}

/**
 * Docs/REPORT-SPEC.md section 9. Classifies the stored AI Overview of each prompt in
 * a run (its winning sample, the one reports show) into the fixed answer-shape
 * vocabulary. Runs on stored text only, so it never searches. A classification is
 * cached by overview hash: an overview already in `answer_shapes` costs no call.
 * A failure on one overview is logged and the rest continue.
 */
export async function classifyRunAnswerShapes(
  input: ClassifyRunAnswerShapesInput
): Promise<ClassifyRunAnswerShapesResult> {
  const secrets = input.secrets ?? []
  const now = input.now ?? (() => new Date().toISOString())
  const result: ClassifyRunAnswerShapesResult = {
    classified: 0,
    cached: 0,
    skipped: 0,
    stopped: false
  }
  const filter = {
    projectId: input.projectId,
    pageIds: null,
    marketId: null,
    from: null,
    to: null,
    runId: input.runId,
    promptId: null
  }
  const run = listStoredCheckRuns(input.db, filter).find((item) => item.id === input.runId)
  if (run === undefined) return result
  const promptText = new Map(
    listStoredMarketPrompts(input.db, run.promptSetId, run.marketId).map((prompt) => [
      prompt.id,
      prompt.text
    ])
  )
  const overviews: { promptId: string; text: string }[] = []
  for (const [promptId, samples] of groupByPrompt(listStoredSerpResults(input.db, filter))) {
    const text = winningOverview(samples)
    if (text === null) result.skipped += 1
    else overviews.push({ promptId, text })
  }
  const cachedShapes = getAnswerShapes(
    input.db,
    overviews.map((overview) => overviewHash(overview.text))
  )
  const pending = new Map<string, PendingOverview>()
  for (const overview of overviews) {
    const hash = overviewHash(overview.text)
    if (cachedShapes.has(hash) || pending.has(hash)) {
      result.cached += 1
      continue
    }
    pending.set(hash, {
      hash,
      promptText: promptText.get(overview.promptId) ?? '',
      overviewText: overview.text
    })
  }
  if (pending.size === 0) return result
  // FR-26.8: the project's own answer_shape version, else the app default.
  const template = loadGenerationTemplate(
    input.appDb,
    'answer_shape',
    undefined,
    'templates:get',
    input.db
  )
  await settleEach([...pending.values()], input.limiter ?? createLimiter(1), async (item) => {
    if (result.stopped || input.shouldStop?.() === true) {
      result.stopped = true
      return
    }
    const overviewText = mask(item.overviewText, secrets)
    const prompt = mask(
      renderTemplate(template.body, {
        prompt_text: mask(item.promptText, secrets),
        overview_text: overviewText
      }).text,
      secrets
    )
    try {
      const reply = await completeStructured({
        db: input.db,
        pageId: run.pageId,
        provider: input.claude,
        logger: input.logger,
        kind: 'answer_shape',
        templateId: template.id,
        templateHash: template.templateHash,
        prompt,
        schema: ANSWER_SHAPE_SCHEMA,
        model: template.settings.model,
        inputHash: llmInputHash({
          templateHash: template.templateHash,
          prompt,
          schema: ANSWER_SHAPE_SCHEMA
        }),
        validate: (value) => {
          const problem = answerShapeSchemaError(value, overviewText)
          return problem === null ? null : { code: 'schema_validation', message: problem }
        },
        secrets,
        caps: input.caps,
        trace: { source: 'report', projectId: input.projectId }
      })
      saveAnswerShape(input.db, {
        overviewHash: item.hash,
        templateHash: template.templateHash,
        blocks: answerShapeBlocks(reply.value),
        classifiedAt: now()
      })
      result.classified += 1
    } catch (error) {
      result.skipped += 1
      input.logger.error('answer shape', {
        outcome: 'error',
        message: mask(
          error instanceof Error ? error.message : 'The CiteFox AI call failed',
          secrets
        )
      })
    }
  })
  if (result.stopped) return result
  input.logger.info('answer shape', {
    outcome: 'ok',
    classified: result.classified,
    cached: result.cached,
    skipped: result.skipped
  })
  return result
}

function groupByPrompt(samples: readonly StoredSerpResult[]): Map<string, StoredSerpResult[]> {
  const groups = new Map<string, StoredSerpResult[]>()
  for (const sample of samples) {
    const group = groups.get(sample.promptId)
    if (group === undefined) groups.set(sample.promptId, [sample])
    else group.push(sample)
  }
  return groups
}

/** The winning sample's overview text, or null when it has none. */
function winningOverview(samples: readonly StoredSerpResult[]): string | null {
  const rolled = rollupSamples(
    samples.map((sample) => ({
      sampleNo: sample.sampleNo,
      status: sample.status,
      named: sample.named,
      citedUrl: sample.citedUrl,
      position: sample.position,
      aioText: sample.aioText,
      references: []
    }))
  )
  const text = rolled.winning?.aioText ?? null
  return text === null || text.trim().length === 0 ? null : text
}

function mask(value: string, secrets: readonly string[]): string {
  return redactString(value, { secrets, hexKeys: true })
}
