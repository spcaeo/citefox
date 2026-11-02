import type { HistoryCheck, HistoryFix, Market, PageResults } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import {
  resultsDrill,
  resultsScope,
  whereDrill,
  type DrillItem,
  type DrillScope,
  type DrillTarget,
  type ItemDrill,
  type PromptDrill
} from '../drill'
import { marketLabel } from '../shell/model'
import { pageHash } from '../shell/routes'
import { formatMoment } from '../utils/dates'

/**
 * History drills (REPORT-SPEC "Interaction model", NFR-14). Pure: each number
 * on a History event opens exactly the prompts it counts, read from that
 * check's own `results:get`, so an old check never shows the latest rows.
 */

/** Key in `HistoryDrillContext.runs` for the page's latest check in the market. */
export const LATEST = '\0latest'

/** What History's drills need: the page, its History market, and every loaded check. */
export interface HistoryDrillContext {
  pageId: string
  /** The market History's checks are from. */
  marketId: string
  market: Market | undefined
  /** `results:get` by run id, plus `LATEST` (runResults.ts). */
  runs: ReadonlyMap<string, PageResults>
}

/** Results for this check, pinned to its run. */
export function checkTarget(context: HistoryDrillContext, check: HistoryCheck): DrillTarget {
  return {
    kind: 'page',
    pageId: context.pageId,
    tab: 'results',
    marketId: check.marketId,
    runId: check.runId
  }
}

/** The Progress tab focused on one fix card (`?filter=fix:<n>`). */
export function fixTarget(context: HistoryDrillContext, fix: HistoryFix): DrillTarget {
  return {
    kind: 'hash',
    hash: pageHash(context.pageId, 'progress', {
      marketId: context.marketId,
      filter: `fix:${fix.number}`
    })
  }
}

/** The Prompts tab, where saved prompt sets are listed and switched. */
export function promptsTarget(context: HistoryDrillContext): DrillTarget {
  return { kind: 'hash', hash: pageHash(context.pageId, 'prompts') }
}

function checkScope(
  context: HistoryDrillContext,
  results: PageResults,
  check: HistoryCheck
): DrillScope {
  return resultsScope(results, {
    pageId: context.pageId,
    market: context.market ?? null,
    runId: check.runId
  })
}

/** The prompts a check ran (a partial check's "x of y prompts"). Null until that check loads. */
export function checkedDrill(
  context: HistoryDrillContext,
  check: HistoryCheck
): PromptDrill | null {
  const results = context.runs.get(check.runId)
  if (!results) return null
  const drill = resultsDrill(results, 'funnel:checked', checkScope(context, results, check))
  if (!drill) return null
  const day = formatMoment(results.scope.checkedAt)
  return {
    ...drill,
    id: `history:checked:${check.runId}`,
    title: check.partial ? `Questions this partial check ran` : `Questions checked`,
    description: check.partial
      ? `This follow-up on ${day} checked only some questions. It is left out of the trend line and has no score change.`
      : `Every question checked on ${day}.`
  }
}

/**
 * Prompts whose result changed since the previous full check in the same
 * prompt set. Null until that check loads, or when it has no previous check.
 */
export function changedDrill(
  context: HistoryDrillContext,
  check: HistoryCheck
): PromptDrill | null {
  const results = context.runs.get(check.runId)
  if (!results || check.partial || check.scoreChange === null) return null
  return whereDrill(
    results,
    {
      id: `history:changed:${check.runId}`,
      title: 'Questions whose result changed',
      description: `Questions with a different result on ${formatMoment(results.scope.checkedAt)} than on the previous full check. The score change is the sum of these moves; it does not say why they moved.`
    },
    (row) => row.previousStatus !== null && row.previousStatus !== row.status,
    checkScope(context, results, check)
  )
}

/**
 * The prompts a fix targeted, one row per targeted position, matched to the
 * latest check's prompts so each row opens Prompt detail. A position with no
 * prompt in the latest check still lists, so the total is the targeted count.
 */
export function fixPromptsDrill(context: HistoryDrillContext, fix: HistoryFix): ItemDrill {
  const latest = context.runs.get(LATEST) ?? null
  const scope: DrillScope = latest
    ? resultsScope(latest, { pageId: context.pageId, market: context.market ?? null })
    : {
        pageId: context.pageId,
        marketId: context.marketId,
        runId: null,
        marketLabel: context.market ? marketLabel(context.market) : '',
        checkDateLabel: '',
        brand: '',
        domain: ''
      }
  const byPosition = new Map((latest?.prompts ?? []).map((row) => [row.promptPosition, row]))
  const items: DrillItem[] = fix.promptPositions.map((position) => {
    const row = byPosition.get(position)
    return {
      id: `${fix.id}:${position}`,
      primary: row ? `${position}. ${row.label.split('**').join('')}` : `Question ${position}`,
      secondary: row ? null : 'Not in the latest check',
      target: row
        ? {
            kind: 'prompt',
            pageId: context.pageId,
            promptId: row.promptId,
            marketId: scope.marketId
          }
        : null
    }
  })
  return {
    kind: 'items',
    id: `history:fix:${fix.id}`,
    title: `Questions fix ${fix.number} targeted`,
    description: fix.verdict
      ? `Verdict: ${fix.verdict}. Select a question to see its AI Overview.`
      : `No verdict yet. Select a question to see its AI Overview.`,
    noun: ['question', 'questions'],
    primaryLabel: 'Question',
    items,
    scope
  }
}

/** The "N prompts" of a prompt-set event, in words. */
export function promptSetCount(count: number): string {
  return pluralize(count, 'question')
}
