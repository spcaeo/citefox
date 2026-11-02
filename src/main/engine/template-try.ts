import {
  settingsForKind,
  usesGroupedVariables,
  type Market,
  type PageSummary
} from '@shared/domain'
import type { TryTemplateRequest, TryTemplateResult } from '@shared/ipc'
import { assistLabel, connectionOf, expectedSeconds } from '../assist/label'
import { IpcRequestError } from '../ipc-request'
import { redactString } from '../logging/redact'
import { PipelineError } from '../pipeline/errors'
import { TEMPLATE_SCHEMAS } from '../pipeline/template-steps'
import { modelFor } from '../pipeline/template-settings'
import { templateHash } from '../pipeline/templates'
import type { ClaudeCompletion } from '../providers/claude/claude-code'
import { ProviderError } from '../providers/errors'
import type { SqliteDatabase } from '../storage/database'
import { getPage, listPageMarkets } from '../storage/pages'
import { getMarket } from '../storage/project-profile'
import { projectClaudeModel, resolveClaude } from './claude'
import type { EngineHost } from './host'
import { withProject } from './project-db'
import { answerShapeStepDraft } from './template-try/answer-shape-step'
import { checkStepDraft } from './template-try/check-steps'
import { pageStepDraft } from './template-try/page-steps'

/**
 * FR-26.6 Try it. Renders a draft template on a real page and market, runs it once
 * through Claude and checks the reply against the step's output fields. It saves
 * nothing: no generation row, no profile, prompt set, coverage matrix or analysis.
 * The call is still logged in `llm_calls` (FR-25.6) with template id `draft`.
 */

const CHANNEL = 'templates:try'

/** "About N s" before a step has any logged call. */
const FALLBACK_SECONDS: Readonly<Record<string, number>> = {
  buyer_profile: 20,
  buyer_prompts: 30,
  coverage: 40,
  coverage_matrix: 30,
  page_audit: 25,
  coverage_fixes: 30,
  aio_gap: 15,
  answer_shape: 15,
  run_summary: 10
}

export async function tryTemplate(
  host: EngineHost,
  request: TryTemplateRequest
): Promise<TryTemplateResult> {
  if (request.body.trim().length === 0) {
    throw new IpcRequestError(CHANNEL, 'Write the template before trying it.')
  }
  return withProject(host, request.projectId, CHANNEL, async ({ project, db }) => {
    const page = getPage(db, request.pageId, request.projectId)
    if (page === null) throw new IpcRequestError(CHANNEL, 'That page was not found')
    const market = pickMarket(db, page, request.marketId)
    const settings = settingsForKind(request.kind, request.settings)
    const secrets = host.knownSecrets()
    const input = {
      db,
      projectId: request.projectId,
      domain: project.domain,
      page,
      market,
      kind: request.kind,
      body: request.body,
      settings,
      secrets
    }
    const draft =
      request.kind === 'answer_shape'
        ? answerShapeStepDraft(input)
        : usesGroupedVariables(request.kind)
          ? checkStepDraft(input)
          : pageStepDraft(input)
    const label = assistLabel(
      connectionOf(host, request.projectId),
      expectedSeconds({ templateKind: request.kind }, [db], FALLBACK_SECONDS[request.kind] ?? 20)
    )
    const model = modelFor(settings, projectClaudeModel(host, request.projectId))
    const provider = resolveClaude(host, CHANNEL, request.projectId)
    const started = Date.now()
    let completion: ClaudeCompletion
    try {
      completion = await provider.complete({
        prompt: draft.prompt,
        schema: TEMPLATE_SCHEMAS[request.kind] ?? null,
        model,
        maxTokens: 8000,
        trace: {
          source: 'pipeline',
          projectId: request.projectId,
          templateKind: request.kind,
          templateId: 'draft',
          templateHash: templateHash(request.body),
          assistId: null
        }
      })
    } catch (error) {
      // A reply that failed the provider's schema check is a result, not a failure.
      if (error instanceof ProviderError && error.code === 'validation') {
        return {
          renderedPrompt: draft.prompt,
          output: '',
          matched: false,
          problem: redactString(error.message, { secrets }),
          durationMs: Math.max(0, Date.now() - started),
          model,
          label,
          savedNothing: true
        }
      }
      throw new PipelineError(
        error instanceof Error ? error.message : 'The CiteFox AI call failed',
        {
          code: 'fetch_failed',
          nextStep:
            error instanceof ProviderError && error.nextStep !== null
              ? error.nextStep
              : 'Try again.',
          secrets
        }
      )
    }
    const value = completion.json ?? parseJson(completion.text)
    const problem = value === null ? 'The reply was not JSON.' : draft.validate(value)
    return {
      renderedPrompt: draft.prompt,
      output: value === null ? completion.text : JSON.stringify(value, null, 2),
      matched: problem === null,
      problem,
      durationMs:
        completion.durationMs > 0 ? completion.durationMs : Math.max(0, Date.now() - started),
      model: completion.resolvedModel ?? completion.model ?? model,
      label,
      savedNothing: true
    }
  })
}

/** The requested market, else the page's default, else its first. It must be on the page. */
function pickMarket(db: SqliteDatabase, page: PageSummary, marketId: string | null): Market {
  const onPage = listPageMarkets(db, page.id).map((link) => link.marketId)
  const wanted = marketId ?? page.defaultMarketId ?? onPage[0] ?? null
  if (wanted === null) {
    throw new PipelineError('This page has no market yet.', {
      code: 'not_found',
      nextStep: 'Add a market to the page first.'
    })
  }
  if (!onPage.includes(wanted))
    throw new IpcRequestError(CHANNEL, 'That market is not on this page')
  const market = getMarket(db, wanted)
  if (market === null) throw new IpcRequestError(CHANNEL, 'That market is not on this page')
  return market
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  for (const candidate of [
    trimmed,
    start >= 0 && end > start ? trimmed.slice(start, end + 1) : ''
  ]) {
    if (candidate.length === 0) continue
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      // Try the next candidate.
    }
  }
  return null
}
