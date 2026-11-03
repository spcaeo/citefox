import type { HelpFillEstimate, RowFillRequest, RowFillResult } from '@shared/ipc'
import { connectionOf } from '../../assist/label'
import { claudePausedReason, projectClaudeModel, resolveClaude } from '../../engine/claude'
import type { EngineHost } from '../../engine/host'
import { knownOutline } from '../../engine/site-outline'
import { REDACTED_PROMPT } from '../../logging/redact'
import { PipelineError } from '../../pipeline/errors'
import { ProviderError } from '../../providers/errors'
import { claudeReady, setupProjectId } from '../sections/service'
import { rowFillDef, type RowFillDef } from './defs'
import { ROW_FILL_SCHEMA, rowFillPrompt, type RowFillPromptInput } from './prompt'
import { readRowFill, replyJson } from './reply'

/**
 * `onboarding:rowFill` and `products:fillRow`: one small AI call that writes the missing
 * second part of a row the person added by hand (a product's job and page, a buyer's
 * situation). It runs on the person's own AI connection through the same provider layer as
 * the section cards, so the "calls at once" gate, the timeout, the call log and usage
 * accounting all apply. Nothing is saved here, and the prompt and reply are never logged.
 */

/** Tokens for the small JSON answer. */
const FILL_MAX_TOKENS = 400

export const NO_AI_REASON = 'CiteFox AI is not set up.'

/** The setup draft's context: the site read this session is the known outline. */
export async function fillSetupRow(
  host: EngineHost,
  request: RowFillRequest
): Promise<RowFillResult> {
  const def = rowFillDef(request.list)
  const { context } = request
  const site = context.domain.trim().length > 0 ? knownOutline(host, context.domain) : null
  return runRowFill(host, 'onboarding:rowFill', setupProjectId(host), def, request.name, {
    name: request.name,
    domain: context.domain,
    summary: context.summary,
    brands: context.brands,
    examples: request.examples,
    site
  })
}

/**
 * One fill. A blank result (the AI did not know the name) is a normal answer, not an
 * error. A failed call throws, and the screen keeps the row as the person typed it.
 */
export async function runRowFill(
  host: EngineHost,
  channel: string,
  projectId: string | null,
  def: RowFillDef,
  name: string,
  input: RowFillPromptInput
): Promise<RowFillResult> {
  const provider = resolveClaude(host, channel, projectId)
  const prompt = rowFillPrompt(def, input, host.knownSecrets())
  host.logger.info('row fill run', {
    list: def.list,
    prompt: REDACTED_PROMPT,
    promptLength: prompt.length
  })
  try {
    const completion = await provider.complete({
      prompt,
      schema: ROW_FILL_SCHEMA as unknown as Record<string, unknown>,
      model: projectClaudeModel(host, projectId),
      maxTokens: FILL_MAX_TOKENS,
      schemaAttempts: 1,
      trace: {
        source: 'assist',
        projectId,
        assistId: def.assistId,
        templateKind: null,
        templateId: null,
        templateHash: null
      }
    })
    const result = readRowFill(def, name, replyJson(completion.json, completion.text), input.site)
    // Counts only: never the prompt, the reply or a row.
    host.logger.info('row fill read', {
      list: def.list,
      filled: result.detail.length > 0,
      page: result.url !== null
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The CiteFox AI call failed'
    throw new PipelineError(message, {
      code: 'fetch_failed',
      nextStep:
        error instanceof ProviderError && error.nextStep ? error.nextStep : 'Try again later.',
      secrets: host.knownSecrets()
    })
  }
}

/** Is CiteFox AI ready for a fill in this project? Reads the connection; never calls the AI. */
export function estimateRowFill(host: EngineHost, projectId: string | null): HelpFillEstimate {
  if (!claudeReady(host, projectId)) {
    return {
      kind: 'rowFill',
      available: false,
      calls: 1,
      costText: '1 AI call',
      reason: NO_AI_REASON
    }
  }
  const paused = claudePausedReason(host, projectId)
  if (paused !== null) {
    return { kind: 'rowFill', available: false, calls: 1, costText: '1 AI call', reason: paused }
  }
  const onPlan = connectionOf(host, projectId) === 'claude-code'
  return {
    kind: 'rowFill',
    available: true,
    calls: 1,
    costText: onPlan ? '1 AI call · on your AI plan' : '1 AI call · about $0.01',
    reason: null
  }
}
