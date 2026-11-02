import { oneLineHeadline } from '@shared/report/headline'
import { allowedNumbers, unknownNumbers } from '../../assistant/numbers'
import { pageCompetitorText } from '../../engine/checks/report-context'
import { resolveCheckTemplates } from '../../engine/checks/report-template-choice'
import { REPORT_WRITING_RULES } from '../../prompts/blocks'
import type { AssistContext, AssistDefinition, AssistReply } from '../types'
import {
  formatRows,
  formatRun,
  marketIdOf,
  marketLabel,
  marketOf,
  pageOf,
  resultsOf
} from './gather'
import { checkTags } from './rules'

/** Report assists. The resolved `run_summary` template is the wording guide. */

type Run = NonNullable<ReturnType<typeof resultsOf>['run']>

/** The report's one-sentence headline, by the same fixed template, for this page's check. */
export function headlineDraft(run: Run): string {
  return oneLineHeadline({
    tracked: run.promptsChecked,
    measured: run.promptsChecked - run.errors,
    aio: run.promptsWithAio,
    cited: run.pageCited + run.otherOwnPage,
    noun: 'buyer prompts',
    topSite: null,
    change: null
  })
}

function summaryFacts(context: AssistContext): string {
  const opened = pageOf(context)
  const marketId = marketIdOf(context, opened.page)
  const results = resultsOf(context, opened, marketId)
  const template = resolveCheckTemplates(
    context.host.storage.db,
    opened.db,
    context.host.logger
  ).runSummary
  const competitors = pageCompetitorText(opened.db, opened.page.id)
  return [
    `Page: ${opened.page.url}`,
    `Market: ${marketLabel(marketOf(opened.db, marketId))}`,
    competitors.product,
    competitors.competitors,
    formatRun(results),
    ...(results.run === null ? [] : [`Headline draft: ${headlineDraft(results.run)}`]),
    '',
    'Prompts:',
    formatRows(results),
    '',
    'Summary template:',
    template.body.trim()
  ].join('\n')
}

/** Numbers in the reply that are in neither the saved data nor the user's instruction. */
export function inventedNumbers(reply: AssistReply, facts: string, instruction: string): string[] {
  const allowed = allowedNumbers(facts, instruction)
  const texts = [
    reply.summary ?? '',
    reply.caution ?? '',
    ...reply.items.flatMap((item) => [item.text, item.detail ?? ''])
  ]
  return [...new Set(texts.flatMap((text) => unknownNumbers(text, allowed)))]
}

export const REPORT_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'report.summary',
    title: 'Rewrite the summary',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 2,
    maxItems: 2,
    task: `Rewrite the run summary for this check from the saved numbers below. Follow the wording and tone of the summary template under "Summary template", but use only these numbers.
Give two items: tag "headline" with a one-sentence headline as text, starting from "Headline draft" (reword it if you like, keep its numbers) and naming the site the overviews cite most often instead of this page; and tag "body" as text: one short paragraph on where the page stands and which sites the overviews cite instead (own pages, the competitors listed below, third parties), then "Next actions" with two or three numbered actions, each naming the page to work on and what to add there.
State what changed and what the page changed, side by side with dates. Never claim that a page edit caused a citation change, and keep citations out of the actions.
${REPORT_WRITING_RULES}`,
    gather: summaryFacts,
    check(reply, context) {
      const tags = reply.items.map((item) => item.tag?.toLowerCase())
      const shape =
        checkTags(reply, ['headline', 'body'], 'Tag the items "headline" and "body".') ??
        (tags.includes('headline') && tags.includes('body')
          ? null
          : 'Give one headline and one body.')
      if (shape !== null) return shape
      // The number check: a number the saved data does not hold was invented.
      const invented = inventedNumbers(
        reply,
        summaryFacts(context),
        context.request.instruction ?? ''
      )
      return invented.length === 0
        ? null
        : `Use only numbers from the saved data. These are not in it: ${invented.join(', ')}.`
    }
  }
]
