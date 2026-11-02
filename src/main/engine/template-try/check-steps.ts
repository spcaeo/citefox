import { redactString } from '../../logging/redact'
import { PipelineError } from '../../pipeline/errors'
import { withSettingsInstructions } from '../../pipeline/template-settings'
import { listStoredCheckRuns } from '../../storage/check-records'
import {
  CheckTemplateError,
  gapSchemaError,
  renderCheckTemplate,
  summarySchemaError,
  type CheckTemplateContext
} from '../checks/report-templates'
import { gapContext, maskContext, promptSections, summaryContext } from '../checks/reports'
import { filterFor, loadPageResults } from '../checks/results'
import type { TryDraft, TryInput } from './types'

/**
 * A check step's draft (`aio_gap`, `run_summary`) rendered with the context the
 * check reports build from the page's latest finished check in the market. The
 * overview gap reads the first prompt of that check Claude would compare. The
 * prompt is masked the same way the reports mask theirs.
 */
export function checkStepDraft(input: TryInput): TryDraft {
  const runs = listStoredCheckRuns(
    input.db,
    filterFor(input.projectId, input.page.id, input.market.id)
  ).filter((run) => run.status === 'finished')
  const run = runs[runs.length - 1]
  if (run === undefined) {
    throw new PipelineError('This page has no finished check in this market.', {
      code: 'not_found',
      nextStep: 'Press Check now in this market first.'
    })
  }
  if (input.page.url === null) {
    throw new PipelineError('Try it needs a page with a URL, not a topic.', {
      code: 'not_found',
      nextStep: 'Pick a page instead.'
    })
  }
  const pageUrl = input.page.url
  const prompts = promptSections(input.db, input.projectId, run, input.secrets)
  let context: CheckTemplateContext
  let validate: TryDraft['validate']
  if (input.kind === 'aio_gap') {
    const compared = prompts.find((prompt) => prompt.compared)
    if (compared === undefined) {
      throw new PipelineError('The latest check has no AI Overview that leaves this page out.', {
        code: 'not_found',
        nextStep: 'Pick a market where the page is not cited, or run a check first.'
      })
    }
    context = gapContext(input.db, run, pageUrl, compared)
    validate = gapSchemaError
  } else {
    const results = loadPageResults(input.db, {
      projectId: input.projectId,
      pageId: input.page.id,
      marketId: input.market.id,
      runId: run.id,
      builtAt: run.finishedAt ?? run.startedAt,
      domain: input.domain,
      keyLabels: new Map()
    })
    context = summaryContext(
      input.db,
      run,
      pageUrl,
      input.page.title,
      results,
      prompts,
      input.secrets
    )
    validate = summarySchemaError
  }
  let text: string
  try {
    text = renderCheckTemplate(input.body, maskContext(context, input.secrets))
  } catch (error) {
    if (!(error instanceof CheckTemplateError)) throw error
    throw new PipelineError('The template has an unknown variable or a syntax error.', {
      code: 'template',
      nextStep: 'Use only the variables listed for this step, then try again.'
    })
  }
  const prompt = redactString(withSettingsInstructions(text, input.kind, input.settings), {
    secrets: input.secrets,
    hexKeys: true
  })
  return { prompt, validate }
}
