import type { PageResults } from '@shared/domain'
import { statusLabel } from '../../engine/checks/report-files'
import { filterFor } from '../../engine/checks/results'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import {
  listFixFollowUps,
  nextFixNumber,
  type FixFollowUpRecord
} from '../../storage/fix-follow-ups'
import { DATA_FENCE_RULE, fence, FIX_DRAFT_RULES, NO_CAUSE_RULE } from '../../prompts/blocks'
import { causeProblem, NEXT_ACTION_RULES } from '../../prompts/citations'
import { listPageMarkets } from '../../storage/pages'
import { AssistInputError, type AssistContext, type AssistDefinition } from '../types'
import { draftBlocksProblem } from './gaps'
import {
  brandNamesOf,
  day,
  formatPageHead,
  formatPageBody,
  formatRows,
  formatRun,
  inputNumber,
  inputText,
  marketIdOf,
  marketLabel,
  marketOf,
  pageOf,
  resultsOf,
  snapshotOf,
  type OpenedPage
} from './gather'
import { formatFixes, formatOpenGaps, replyTexts } from './results'

/** Progress screen assists. "Other markets" compares saved checks only. */

function fixOf(opened: OpenedPage, context: AssistContext): FixFollowUpRecord {
  const number = inputNumber(context, 'fixNumber')
  const fix =
    number === null
      ? undefined
      : listFixFollowUps(opened.db, opened.page.id).find((item) => item.number === number)
  if (fix === undefined) {
    throw new AssistInputError('That fix was not found.', 'Pick a logged fix, then try again.')
  }
  return fix
}

function finishedRuns(opened: OpenedPage, marketId: string): StoredCheckRun[] {
  return listStoredCheckRuns(
    opened.db,
    filterFor(opened.project.id, opened.page.id, marketId)
  ).filter((run) => run.status === 'finished' && run.finishedAt !== null)
}

function statusesIn(results: PageResults, promptIds: readonly string[]): string {
  return promptIds
    .map((promptId) => {
      const row = results.prompts.find((item) => item.promptId === promptId)
      if (row === undefined) return `prompt id ${promptId}: not checked`
      const position = row.position === null ? '' : ` #${row.position}`
      return `prompt ${row.promptPosition}: ${statusLabel(row.status)}${position}`
    })
    .join('; ')
}

/** Each market's status for the fix's prompts before and after it went live. */
function formatMarketsAroundFix(
  context: AssistContext,
  opened: OpenedPage,
  fix: FixFollowUpRecord
): string {
  const lines: string[] = []
  for (const link of listPageMarkets(opened.db, opened.page.id)) {
    const market = marketOf(opened.db, link.marketId)
    const runs = finishedRuns(opened, market.id)
    const before = runs.filter((run) => (run.finishedAt ?? '') < fix.goLiveAt).at(-1) ?? null
    const after = runs.filter((run) => run.startedAt >= fix.goLiveAt).at(-1) ?? null
    const parts = [`Market ${market.id} (${marketLabel(market)}):`]
    parts.push(
      before === null
        ? '  Before the fix: no saved check.'
        : `  Before the fix (check of ${day(before.finishedAt)}): ${statusesIn(resultsOf(context, opened, market.id, before.id), fix.promptIds)}.`
    )
    parts.push(
      after === null
        ? `  After the fix: no check since it went live on ${day(fix.goLiveAt)}.`
        : `  After the fix (check of ${day(after.finishedAt)}${after.partial ? ', follow-up' : ''}): ${statusesIn(resultsOf(context, opened, market.id, after.id), fix.promptIds)}.`
    )
    lines.push(parts.join('\n'))
  }
  return lines.length === 0 ? 'This page has no markets.' : lines.join('\n')
}

export const PROGRESS_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'progress.nextFix',
    title: 'Suggest the next fix',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: 3,
    task: `Suggest the next fix for this page from the open coverage gaps and the prompts that lost or never had a citation of this page.
${NEXT_ACTION_RULES}
- A fix already under "Fixes logged" is done or waiting for its follow-up check; suggest something else.
One item per fix, best first: text is the fix as one instruction that names the section of this page, detail names the prompts it covers and the gap it closes, tag is the priority: high, medium, or low.`,
    gather(context) {
      const opened = pageOf(context)
      const marketId = marketIdOf(context, opened.page)
      const results = resultsOf(context, opened, marketId)
      return [
        `Market: ${marketLabel(marketOf(opened.db, marketId))}`,
        formatRun(results),
        '',
        'Prompts:',
        formatRows(results),
        '',
        'Open coverage gaps:',
        formatOpenGaps(opened.db, opened.page.id, results.run?.contentHash ?? ''),
        '',
        'Fixes logged:',
        formatFixes(opened.db, opened.page.id)
      ].join('\n')
    },
    check: (reply) => causeProblem(replyTexts(reply))
  },
  {
    id: 'progress.otherMarkets',
    title: 'Check if the fix worked in other markets',
    expectedSeconds: 8,
    acceptsInstruction: false,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: 12,
    task: `Compare each market's status for the fix's prompts before and after the fix went live, from the saved checks below.
One item per market: text says what changed for the fix's prompts in that market, detail gives the before and after statuses with the check dates, tag is the market id.
When a market has no check after the fix went live, say so plainly in that item and suggest running a check there. Do not guess its result.
Say what changed and when, side by side with the fix date. ${NO_CAUSE_RULE}
summary starts with "No new searches were run." and then sums up the markets in one or two sentences.`,
    gather(context) {
      const opened = pageOf(context)
      const fix = fixOf(opened, context)
      return [
        `Fix ${fix.number}, live ${day(fix.goLiveAt)}: ${fix.description}`,
        `Fix prompts: ${fix.promptIds.join(', ')}`,
        `Fix was logged for markets: ${fix.marketIds.join(', ')}`,
        '',
        formatMarketsAroundFix(context, opened, fix)
      ].join('\n')
    },
    // No claimsCause check: each item puts the fix date beside the citation change.
    check(reply) {
      return reply.summary !== null && /no (new )?searches/i.test(reply.summary)
        ? null
        : 'Say in the summary that no new searches were run.'
    }
  },
  {
    id: 'progress.draftFix',
    title: 'Draft the fix',
    expectedSeconds: 10,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: 4,
    task: `Draft the fix under "Fix to draft" for this page.
The first item is the fix log entry: tag "Fix <number>", text is one sentence saying what will change on the page, detail lists the prompts it targets.
Then one item per block to paste into the page: tag "update" or "new FAQ", text is the wording (for a new FAQ, the question on the first line as the buyer would ask it, then the answer), detail names the section exactly as it appears on the page.
${FIX_DRAFT_RULES}
${DATA_FENCE_RULE}`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const number = inputNumber(context, 'fixNumber') ?? nextFixNumber(opened.db, opened.page.id)
      const gap = inputText(context, 'gap')
      const saved = listFixFollowUps(opened.db, opened.page.id).find(
        (item) => item.number === number
      )
      const target = gap ?? (saved === undefined ? null : `Saved description: ${saved.description}`)
      return [
        `Fix to draft: Fix ${number}`,
        target === null ? 'Pick the most important open gap below.' : `Gap: ${target}`,
        '',
        'Open coverage gaps:',
        formatOpenGaps(opened.db, opened.page.id, snapshot.contentHash),
        '',
        'Fixes logged:',
        formatFixes(opened.db, opened.page.id),
        '',
        formatPageHead(opened.page, snapshot),
        '',
        fence('page_text', formatPageBody(snapshot))
      ].join('\n')
    },
    check: (reply, context) => draftBlocksProblem(reply, brandNamesOf(pageOf(context).db))
  }
]
