import { answerShapeSchemaError } from '../../analytics/answer-shape/schema'
import { PipelineError } from '../../pipeline/errors'
import { withSettingsInstructions } from '../../pipeline/template-settings'
import { renderTemplate } from '../../pipeline/templates'
import {
  listStoredCheckRuns,
  listStoredMarketPrompts,
  listStoredSerpResults
} from '../../storage/check-records'
import type { TryDraft, TryInput } from './types'

/**
 * The answer-shape draft (Docs/REPORT-SPEC.md section 9) rendered on the page's
 * newest stored AI Overview in the market, as the report step renders it: stored
 * text only, never a search. The reply is checked like the real step, so every
 * excerpt must come from that overview.
 */
export function answerShapeStepDraft(input: TryInput): TryDraft {
  const filter = {
    projectId: input.projectId,
    pageIds: [input.page.id],
    marketId: input.market.id,
    from: null,
    to: null,
    runId: null,
    promptId: null
  }
  const runs = listStoredCheckRuns(input.db, filter)
    .filter((run) => run.status === 'finished')
    .reverse()
  const samples = listStoredSerpResults(input.db, filter)
  for (const run of runs) {
    const sample = samples.find(
      (item) => item.runId === run.id && item.aioText !== null && item.aioText.trim().length > 0
    )
    if (sample === undefined || sample.aioText === null) continue
    const promptText =
      listStoredMarketPrompts(input.db, run.promptSetId, run.marketId).find(
        (prompt) => prompt.id === sample.promptId
      )?.text ?? ''
    const overviewText = sample.aioText
    const rendered = renderTemplate(input.body, {
      prompt_text: promptText,
      overview_text: overviewText
    })
    return {
      prompt: withSettingsInstructions(rendered.text, input.kind, input.settings),
      validate: (value) => answerShapeSchemaError(value, overviewText)
    }
  }
  throw new PipelineError('This page has no stored AI Overview in this market yet.', {
    code: 'not_found',
    nextStep: 'Press Check now, and come back once a check finds an AI Overview.'
  })
}
