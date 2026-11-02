import type { AioGapFact, PageResults, PromptCheckStatus } from '@shared/domain'
import type { Logger } from '../../logging/logger'
import { redactString, redactValue } from '../../logging/redact'
import { llmInputHash } from '../../pipeline/hash'
import {
  completeStructured,
  type GenerationCallCaps,
  type StructuredGenerationKind
} from '../../pipeline/llm'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { saveRunAnalysis } from '../../storage/analyses'
import type { AtomicFileIo } from '../../storage/atomic-file'
import {
  listStoredAioReferences,
  listStoredCheckRuns,
  listStoredMarketPrompts,
  listStoredSerpResults,
  type StoredAioReference,
  type StoredCheckRun
} from '../../storage/check-records'
import { getLatestBuyerProfile, getStoredSnapshot } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { getMarket, readProjectProfile } from '../../storage/project-profile'
import { getPage } from '../../storage/pages'
import { mapEach } from '../parallel'
import { createLimiter, type Limiter } from './check-pace'
import { filterFor, loadPageResults } from './results'
import { rollupSamples, type ScoreSample } from './score'
import { modelFor, withSettingsInstructions } from '../../pipeline/template-settings'
import { renderableCheckTemplates } from './report-template-choice'
import { fence } from '../../prompts/blocks'
import {
  cleanLikelySource,
  pageCompetitorText,
  promptResultLines,
  referenceText,
  summaryBodyText
} from './report-context'
import {
  AIO_GAP_SCHEMA,
  CheckTemplateError,
  RUN_SUMMARY_SCHEMA,
  SHIPPED_CHECK_TEMPLATES,
  gapSchemaError,
  renderCheckTemplate,
  summarySchemaError,
  type CheckTemplateChoice,
  type CheckTemplateContext,
  type CheckTemplates
} from './report-templates'
import {
  NOTES_ABSENT,
  SUMMARY_CLOSING,
  aioGapPath,
  headlineSentence,
  redactReport,
  renderAioGapMarkdown,
  renderRunSummaryMarkdown,
  runSummaryPath,
  statusLabel,
  writeReportFile,
  type AioGapPromptSection,
  type ReportReferenceLine,
  type RunSummaryDocument
} from './report-files'

const GAP_STATUSES = new Set<PromptCheckStatus>(['other_own_page', 'brand_mentioned', 'not_cited'])

const CLASS_LABEL = {
  target: 'this page',
  own: 'own',
  competitor: 'competitor',
  other: 'other'
} as const

export interface WriteCheckReportsInput {
  db: SqliteDatabase
  projectId: string
  runId: string
  domain: string
  reportsRoot: string
  claude: ClaudeProvider
  secrets?: readonly string[]
  logger: Logger
  io?: AtomicFileIo
  /** Same daily and monthly caps as `completeStructured`. Omit for the shared default. */
  caps?: GenerationCallCaps
  /**
   * Checked before each Claude call. True stops the report: no further call is
   * made and no file is written. A cancel uses this.
   */
  shouldStop?: () => boolean
  /** The project's resolved check templates (FR-26.8). Omit for the shipped ones. */
  templates?: CheckTemplates
  /** The job's Claude limiter: the gap questions run side by side up to its size. */
  limiter?: Limiter
}

export type WriteCheckReportsResult = 'written' | 'skipped'

/**
 * FR-6.6 and FR-12.3. Writes `aio_gap.md` and `run_summary.md` after a finished run.
 * A running, cancelled, or error run writes nothing. The SRS does not ask for a file
 * on cancel, and an error run has no completed comparison to store.
 * A report stopped through `shouldStop` writes nothing and returns `skipped`.
 */
export async function writeCheckReports(
  request: WriteCheckReportsInput
): Promise<WriteCheckReportsResult> {
  const input: WriteCheckReportsInput = {
    ...request,
    templates: renderableCheckTemplates(
      request.templates ?? SHIPPED_CHECK_TEMPLATES,
      request.logger
    )
  }
  const secrets = input.secrets ?? []
  const run = listStoredCheckRuns(
    input.db,
    filterFor(input.projectId, null, null, input.runId)
  ).find((item) => item.id === input.runId)
  if (run === undefined || run.status !== 'finished') return 'skipped'
  const page = getPage(input.db, run.pageId, input.projectId)
  if (page === null) return 'skipped'
  // A topic has no single page to compare an overview against. Topic results
  // write their own summary (`topic_summary`) from saved data instead.
  if (page.url === null) return 'skipped'
  const pageUrl = page.url
  const results = loadPageResults(input.db, {
    projectId: input.projectId,
    pageId: run.pageId,
    marketId: run.marketId,
    runId: run.id,
    builtAt: run.finishedAt ?? run.startedAt,
    domain: input.domain,
    keyLabels: new Map()
  })
  const drafted = promptSections(input.db, input.projectId, run, secrets)
  const prompts: AioGapPromptSection[] = []
  const gapGenerationIds: string[] = []
  const gapAttempted = drafted.some((prompt) => prompt.compared)
  // One gap question per compared prompt, side by side; kept in prompt order.
  let stopped = false
  const answers = await mapEach(drafted, input.limiter ?? createLimiter(1), async (prompt) => {
    if (!prompt.compared) return null
    if (stopped || input.shouldStop?.() === true) {
      stopped = true
      return null
    }
    return askForGap(input, run, pageUrl, prompt, secrets)
  })
  if (stopped) return 'skipped'
  for (const [index, prompt] of drafted.entries()) {
    if (!prompt.compared) {
      prompts.push(prompt)
      continue
    }
    const asked = answers[index] ?? null
    if (asked === null) {
      prompts.push({
        ...prompt,
        compared: false,
        skipReason: 'Claude did not return facts that matched the schema.'
      })
      continue
    }
    if (asked.generationId !== null) gapGenerationIds.push(asked.generationId)
    prompts.push({ ...prompt, facts: asked.facts })
  }
  const templates = input.templates ?? SHIPPED_CHECK_TEMPLATES
  const gapMarkdown = redactReport(
    renderAioGapMarkdown({
      templateHash: templates.aioGap.hash,
      runId: run.id,
      pageUrl,
      marketLine: marketLine(input.db, run.marketId),
      prompts
    }),
    templates.aioGap.hash,
    secrets
  )
  if (input.shouldStop?.() === true) return 'skipped'
  const summaryResult = await askForSummary(
    input,
    run,
    pageUrl,
    page.title,
    results,
    prompts,
    secrets
  )
  if (input.shouldStop?.() === true) return 'skipped'
  const summary = summaryResult.document
  const summaryMarkdown = redactReport(
    renderRunSummaryMarkdown(summary),
    templates.runSummary.hash,
    secrets
  )
  writeReportFile(aioGapPath(input.reportsRoot, input.projectId, run.id), gapMarkdown, input.io)
  writeReportFile(
    runSummaryPath(input.reportsRoot, input.projectId, run.id),
    summaryMarkdown,
    input.io
  )
  const compared = prompts.filter((prompt) => prompt.compared)
  const gapGenerationId = gapGenerationIds[gapGenerationIds.length - 1] ?? null
  saveCheckAnalysis(input.db, run, secrets, {
    kind: 'aio_gap',
    promptId: compared.length === 1 ? (compared[0]?.id ?? null) : null,
    generationId: gapGenerationId,
    templateHash: templates.aioGap.hash,
    done: !gapAttempted || gapGenerationId !== null,
    body: {
      prompts: compared.map((prompt) => ({
        promptId: prompt.id,
        facts: prompt.facts
      }))
    }
  })
  saveCheckAnalysis(input.db, run, secrets, {
    kind: 'summary',
    promptId: null,
    generationId: summaryResult.generationId,
    templateHash: templates.runSummary.hash,
    done: summaryResult.generationId !== null,
    body: {
      headline: summary.headline,
      body: summary.body,
      aiosShown: summary.aiosShown,
      pageCited: summary.pageCited,
      otherOwnPage: summary.otherOwnPage,
      namedWithoutLink: summary.namedWithoutLink,
      invisible: summary.invisible
    }
  })
  return 'written'
}

/** One section per prompt of the run, with its rolled-up status and overview. */
export function promptSections(
  db: SqliteDatabase,
  projectId: string,
  run: StoredCheckRun,
  secrets: readonly string[]
): AioGapPromptSection[] {
  const facts = listStoredMarketPrompts(db, run.promptSetId, run.marketId)
  const samples = listStoredSerpResults(db, filterFor(projectId, run.pageId, run.marketId, run.id))
  const references = listStoredAioReferences(
    db,
    filterFor(projectId, run.pageId, run.marketId, run.id)
  )
  const sections: AioGapPromptSection[] = []
  for (const fact of facts) {
    const group = samples.filter((sample) => sample.promptId === fact.id)
    if (group.length === 0) continue
    const rolled = rollupSamples(
      group.map((sample) =>
        toScoreSample(
          sample,
          references.filter((ref) => ref.promptId === fact.id)
        )
      )
    )
    const winning = rolled.winning
    const overview = winning?.aioText ?? null
    const skip = skipReason(rolled.status, overview)
    sections.push({
      id: fact.id,
      position: fact.position,
      label: fact.label,
      text: mask(fact.text, secrets),
      status: rolled.status,
      overview: overview === null ? null : mask(overview, secrets),
      compared: skip === null,
      skipReason: skip,
      facts: [],
      references: (winning?.references ?? []).map((reference) => toLine(reference))
    })
  }
  return sections
}

function toScoreSample(
  sample: ReturnType<typeof listStoredSerpResults>[number],
  references: readonly StoredAioReference[]
): ScoreSample {
  return {
    sampleNo: sample.sampleNo,
    status: sample.status,
    named: sample.named,
    citedUrl: sample.citedUrl,
    position: sample.position,
    aioText: sample.aioText,
    references: references
      .filter((reference) => reference.serpResultId === sample.id)
      .map((reference) => ({
        id: reference.id,
        position: reference.position,
        url: reference.url,
        normalizedUrl: reference.normalizedUrl,
        domain: reference.domain,
        title: reference.title,
        classification: reference.classification,
        untracked: reference.untracked,
        sourceType: reference.sourceType
      }))
  }
}

function toLine(
  reference: StoredAioReference | ScoreSample['references'][number]
): ReportReferenceLine {
  return {
    position: reference.position,
    title: reference.title ?? reference.domain,
    classification: CLASS_LABEL[reference.classification],
    url: reference.url
  }
}

function skipReason(status: PromptCheckStatus, overview: string | null): string | null {
  if (status === 'page_cited') {
    return 'the target page is cited, so Claude did not compare this overview with the snapshot.'
  }
  if (status === 'error') {
    return 'the search was recorded as an error, so Claude did not compare it.'
  }
  if (status === 'no_aio' || overview === null || overview.trim().length === 0) {
    return 'there is no overview text to compare with the snapshot.'
  }
  if (!GAP_STATUSES.has(status)) return 'Claude did not compare this prompt.'
  return null
}

async function askForGap(
  input: WriteCheckReportsInput,
  run: StoredCheckRun,
  pageUrl: string,
  prompt: AioGapPromptSection,
  secrets: readonly string[]
): Promise<{ facts: readonly AioGapFact[]; generationId: string | null } | null> {
  const context = gapContext(input.db, run, pageUrl, prompt)
  const template = (input.templates ?? SHIPPED_CHECK_TEMPLATES).aioGap
  const rendered = renderChoice(input, template, 'aio_gap', maskContext(context, secrets))
  if (rendered === null) return null
  const value = await completeJson(input, {
    pageId: run.pageId,
    kind: 'aio_gap',
    template: template.id,
    templateHash: template.hash,
    model: modelFor(template.settings, null),
    prompt: rendered,
    schema: AIO_GAP_SCHEMA,
    validate: gapSchemaError,
    secrets
  })
  if (value === null) return null
  const facts = (value.value as { facts: { fact: string; likelySource: string | null }[] }).facts
  return {
    generationId: value.generationId,
    facts: facts.map((fact) => ({
      fact: fact.fact.replace(/\s+/g, ' ').trim(),
      likelySource: cleanLikelySource(fact.likelySource, prompt.references)
    }))
  }
}

async function askForSummary(
  input: WriteCheckReportsInput,
  run: StoredCheckRun,
  pageUrl: string,
  pageTitle: string | null,
  results: PageResults,
  prompts: readonly AioGapPromptSection[],
  secrets: readonly string[]
): Promise<{ document: RunSummaryDocument; generationId: string | null }> {
  const counts = summaryCounts(results)
  const citation = citationParagraph(results)
  const content = contentParagraph(results)
  const context = summaryContext(input.db, run, pageUrl, pageTitle, results, prompts, secrets)
  const template = (input.templates ?? SHIPPED_CHECK_TEMPLATES).runSummary
  const prompt = renderChoice(input, template, 'run_summary', maskContext(context, secrets))
  const value =
    prompt === null
      ? null
      : await completeJson(input, {
          pageId: run.pageId,
          kind: 'summary',
          template: template.id,
          templateHash: template.hash,
          model: modelFor(template.settings, null),
          prompt,
          schema: RUN_SUMMARY_SCHEMA,
          validate: summarySchemaError,
          secrets
        })
  // The headline stays the code's exact counts; Claude's headline (the main finding)
  // leads its body in bold.
  const reply = value?.value as { headline: string; body: string } | undefined
  const claudeBody =
    reply === undefined
      ? 'Claude did not return a summary that matched the schema.'
      : summaryBodyText(
          `**${reply.headline.replace(/\*+/gu, '').replace(/\s+/gu, ' ').trim()}**\n\n${reply.body}`
        )
  const headline = headlineSentence(counts)
  const body = [claudeBody, citation, content, NOTES_ABSENT, SUMMARY_CLOSING].join('\n\n')
  return {
    generationId: value?.generationId ?? null,
    document: {
      templateHash: template.hash,
      headline,
      body,
      ...counts,
      citation,
      content,
      notes: NOTES_ABSENT,
      closing: SUMMARY_CLOSING
    }
  }
}

/** The `aio_gap` context for one compared prompt of a run (also read by Try it). */
export function gapContext(
  db: SqliteDatabase,
  run: StoredCheckRun,
  pageUrl: string,
  prompt: AioGapPromptSection
): CheckTemplateContext {
  const context = baseContext(db, run, pageUrl, null)
  const { competitorOf } = pageCompetitorText(db, run.pageId)
  context.aio = {
    prompt: prompt.text,
    text: fence('overview', prompt.overview ?? ''),
    references:
      prompt.references.length === 0
        ? 'No cited sources.'
        : prompt.references.map((reference) => referenceText(reference, competitorOf)).join('\n'),
    status: statusLabel(prompt.status)
  }
  return context
}

/** The `run_summary` context for a finished run (also read by Try it). */
export function summaryContext(
  db: SqliteDatabase,
  run: StoredCheckRun,
  pageUrl: string,
  pageTitle: string | null,
  results: PageResults,
  prompts: readonly AioGapPromptSection[],
  secrets: readonly string[]
): CheckTemplateContext {
  const metrics = results.run
  const counts = summaryCounts(results)
  const context = baseContext(db, run, pageUrl, pageTitle ?? '')
  context.page.title = mask(pageTitle ?? '', secrets)
  context.count = String(metrics?.promptsChecked ?? prompts.length)
  context.prompts = promptResultLines(prompts, pageCompetitorText(db, run.pageId).competitorOf)
  context.run = {
    aios_shown: String(counts.aiosShown),
    page_cited: String(counts.pageCited),
    other_own_page: String(counts.otherOwnPage),
    named_without_link: String(counts.namedWithoutLink),
    invisible: String(counts.invisible),
    previous_page_cited: rateNumber(results.comparison[1]),
    baseline_page_cited: rateNumber(results.comparison[0]),
    content_changed: metrics?.contentChanged === true ? 'yes' : 'no',
    content_change: contentParagraph(results)
  }
  return context
}

function summaryCounts(results: PageResults): {
  aiosShown: number
  pageCited: number
  otherOwnPage: number
  namedWithoutLink: number
  invisible: number
} {
  const metrics = results.run
  return {
    aiosShown: metrics?.promptsWithAio ?? 0,
    pageCited: metrics?.pageCited ?? 0,
    otherOwnPage: metrics?.otherOwnPage ?? 0,
    namedWithoutLink: metrics?.brandMentioned ?? 0,
    invisible: metrics?.notCited ?? 0
  }
}

function baseContext(
  db: SqliteDatabase,
  run: StoredCheckRun,
  pageUrl: string,
  /** Null reads the title of the snapshot the check used. */
  pageTitle: string | null
): CheckTemplateContext {
  const snapshot = getStoredSnapshot(db, run.snapshotId)
  const profile = readProjectProfile(db)
  const buyer = getLatestBuyerProfile(db, run.pageId)
  const market = getMarket(db, run.marketId)
  const competitors = pageCompetitorText(db, run.pageId)
  const icp =
    buyer === null
      ? 'none'
      : [buyer.who, buyer.environment]
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
          .join(' ') || 'none'
  return {
    page: {
      url: pageUrl,
      title: pageTitle ?? snapshot?.title ?? '',
      meta_description: snapshot?.metaDescription ?? '',
      h1: snapshot?.h1 ?? '',
      body: fence('page_text', snapshot?.bodyText ?? '')
    },
    market: {
      country: market?.country ?? '',
      language: market?.language ?? '',
      location: market?.location ?? 'none',
      device: market?.device ?? ''
    },
    icp,
    product: competitors.product,
    brand_names: (profile?.brandNames ?? []).join(', ') || 'none',
    // Same product, different competitors: the page's product's own list.
    competitors: competitors.competitors,
    count: '0',
    prompts: '',
    aio: { prompt: '', text: '', references: '', status: '' },
    run: {
      aios_shown: '0',
      page_cited: '0',
      other_own_page: '0',
      named_without_link: '0',
      invisible: '0',
      previous_page_cited: 'none',
      baseline_page_cited: 'none',
      content_changed: 'no',
      content_change: 'The content fingerprint did not change.'
    },
    notes: NOTES_ABSENT
  }
}

function marketLine(db: SqliteDatabase, marketId: string): string {
  const market = getMarket(db, marketId)
  if (market === null) return marketId
  const place = market.location === null ? null : market.location
  const parts = [market.country, place, market.language, market.device].filter(
    (part): part is string => part !== null && part.length > 0
  )
  return parts.join(' · ')
}

function citationParagraph(results: PageResults): string {
  const baseline = results.comparison[0]
  const previous = results.comparison[1]
  const current = results.comparison[2]
  return `Current citation rate: ${rate(current)}. Previous citation rate: ${rate(previous)}. Baseline citation rate: ${rate(baseline)}.`
}

function rate(column: PageResults['comparison'][number] | undefined): string {
  if (
    column === undefined ||
    column.runId === null ||
    column.pageCited === null ||
    column.aiosShown === null
  ) {
    return 'no check'
  }
  if (column.aiosShown === 0) return 'no AI Overview'
  const pct = Math.round((column.pageCited / column.aiosShown) * 100)
  return `${pct}% (${column.pageCited} of ${column.aiosShown} AIOs shown)`
}

function rateNumber(column: PageResults['comparison'][number] | undefined): string {
  if (column === undefined || column.pageCited === null) return 'none'
  return String(column.pageCited)
}

function saveCheckAnalysis(
  db: SqliteDatabase,
  run: StoredCheckRun,
  secrets: readonly string[],
  analysis: {
    kind: 'aio_gap' | 'summary'
    promptId: string | null
    generationId: string | null
    templateHash: string
    done: boolean
    body: unknown
  }
): void {
  saveRunAnalysis(db, {
    runId: run.id,
    snapshotId: null,
    marketId: run.marketId,
    generationId: analysis.generationId,
    kind: analysis.kind,
    promptId: analysis.promptId,
    body: redactValue(analysis.body, { secrets, hexKeys: false }),
    templateHash: analysis.templateHash,
    done: analysis.done
  })
}

function contentParagraph(results: PageResults): string {
  const run = results.run
  if (run === null || !run.contentChanged) return 'The content fingerprint did not change.'
  if (run.contentChange === null) return 'The content fingerprint changed.'
  return `The content fingerprint changed. ${run.contentChange.summary}`
}

async function completeJson(
  input: WriteCheckReportsInput,
  call: {
    pageId: string
    kind: StructuredGenerationKind
    template: string
    templateHash: string
    model?: string | null
    prompt: string
    schema: Record<string, unknown>
    validate: (value: unknown) => string | null
    secrets: readonly string[]
  }
): Promise<{ value: unknown; generationId: string | null } | null> {
  const prompt = redactString(call.prompt, { secrets: call.secrets, hexKeys: true })
  try {
    const result = await completeStructured({
      db: input.db,
      pageId: call.pageId,
      provider: input.claude,
      logger: input.logger,
      kind: call.kind,
      templateId: call.template,
      templateHash: call.templateHash,
      prompt,
      schema: call.schema,
      model: call.model ?? null,
      inputHash: llmInputHash({
        templateHash: call.templateHash,
        prompt,
        schema: call.schema
      }),
      validate: (value) => {
        const problem = call.validate(value)
        if (problem === null) return null
        return { code: 'schema_validation', message: problem }
      },
      secrets: call.secrets,
      caps: input.caps,
      trace: { source: 'report', projectId: input.projectId }
    })
    input.logger.info('check report', { template: call.template, outcome: 'ok' })
    return { value: result.value, generationId: result.generationId }
  } catch (error) {
    input.logger.error('check report', {
      template: call.template,
      outcome: 'error',
      message: redactString(error instanceof Error ? error.message : 'The CiteFox AI call failed', {
        secrets: call.secrets,
        hexKeys: true
      })
    })
    return null
  }
}

/**
 * The chosen template rendered with its settings lines. `writeCheckReports` has
 * already swapped a body that does not render for the shipped one; a render
 * error here still skips this report step instead of stopping the check.
 */
function renderChoice(
  input: WriteCheckReportsInput,
  template: CheckTemplateChoice,
  kind: 'aio_gap' | 'run_summary',
  context: CheckTemplateContext
): string | null {
  try {
    return withSettingsInstructions(
      renderCheckTemplate(template.body, context),
      kind,
      template.settings
    )
  } catch (error) {
    if (!(error instanceof CheckTemplateError)) throw error
    input.logger.error('check report', { template: template.id, outcome: 'template_error' })
    return null
  }
}

function mask(value: string, secrets: readonly string[]): string {
  return redactString(value, { secrets, hexKeys: true })
}

export function maskContext(
  context: CheckTemplateContext,
  secrets: readonly string[]
): CheckTemplateContext {
  return {
    ...context,
    page: {
      url: mask(context.page.url, secrets),
      title: mask(context.page.title, secrets),
      meta_description: mask(context.page.meta_description, secrets),
      h1: mask(context.page.h1, secrets),
      body: mask(context.page.body, secrets)
    },
    icp: mask(context.icp, secrets),
    product: mask(context.product, secrets),
    brand_names: mask(context.brand_names, secrets),
    competitors: mask(context.competitors, secrets),
    prompts: mask(context.prompts, secrets),
    aio: {
      prompt: mask(context.aio.prompt, secrets),
      text: mask(context.aio.text, secrets),
      references: mask(context.aio.references, secrets),
      status: context.aio.status
    },
    notes: mask(context.notes, secrets)
  }
}
