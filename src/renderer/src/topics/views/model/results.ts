import type { PromptCheckStatus, TopicRowState } from '@shared/domain'
import { GOOGLE_WORDS, type ResultWords } from '../../../ui/resultWords'
import {
  SEARCH_RESULTS,
  type ResultCounts,
  type Search,
  type SearchResult,
  type Totals
} from './types'

/** Short words for a result: legends, chips, list cells. */
export const RESULT_LABEL: Readonly<Record<SearchResult, string>> = {
  not_cited: 'Not cited',
  other_page: 'Your other page',
  target: 'Right page',
  no_overview: 'No AI Overview',
  not_checked: 'Not checked yet'
}

/** A tree branch's heading. */
export const RESULT_HEADING: Readonly<Record<SearchResult, string>> = {
  not_cited: 'Not cited',
  other_page: 'Your other page is cited',
  target: 'Right page cited',
  no_overview: 'No AI Overview',
  not_checked: 'Not checked yet'
}

/** Legend words after a count ("96 not cited"). */
export const RESULT_LEGEND: Readonly<Record<SearchResult, string>> = {
  not_cited: 'not cited',
  other_page: 'your other page',
  target: 'right page cited',
  no_overview: 'no AI Overview',
  not_checked: 'not checked yet'
}

/** {@link RESULT_LABEL} on the picked engine: "No answer" on ChatGPT. */
export function resultLabel(result: SearchResult, words: ResultWords = GOOGLE_WORDS): string {
  if (result === 'target' && words.cited) return words.cited.label
  return result === 'no_overview' ? words.none : RESULT_LABEL[result]
}

/** {@link RESULT_HEADING} on the picked engine. */
export function resultHeading(result: SearchResult, words: ResultWords = GOOGLE_WORDS): string {
  if (result === 'target' && words.cited) return words.cited.heading
  return result === 'no_overview' ? words.none : RESULT_HEADING[result]
}

/** {@link RESULT_LEGEND} on the picked engine: "no answer" on ChatGPT. */
export function resultLegend(result: SearchResult, words: ResultWords = GOOGLE_WORDS): string {
  if (result === 'target' && words.cited) return words.cited.legend
  return result === 'no_overview' ? words.noneLegend : RESULT_LEGEND[result]
}

/**
 * The "What to do" line per result. `no_overview` names the next check when there is one
 * ("checked again Nov 12"); the caller passes the date in words.
 */
export function whatToDo(
  result: SearchResult,
  nextCheck: string | null = null,
  words: ResultWords = GOOGLE_WORDS
): string {
  switch (result) {
    case 'not_cited':
      return 'Improve the target page, highest win odds first.'
    case 'other_page':
      return 'Keep that page as the owner, or strengthen the target page.'
    case 'target':
      return 'Done. Wins land here.'
    case 'no_overview':
      return nextCheck ? `${words.noneTodo} Checked again ${nextCheck}.` : words.noneTodo
    case 'not_checked':
      return 'Nothing to do yet: the next check fills it in.'
  }
}

/** A topic row's match state in the result language. */
export function resultOfTopicState(state: TopicRowState): SearchResult {
  switch (state) {
    case 'right_page':
      return 'target'
    case 'other_page':
      return 'other_page'
    case 'not_cited':
    case 'no_page':
      return 'not_cited'
    case 'no_aio':
      return 'no_overview'
    case 'failed':
    case 'not_checked':
      return 'not_checked'
  }
}

/** A question's rolled-up check status in the result language. Null is not checked. */
export function resultOfStatus(status: PromptCheckStatus | null): SearchResult {
  switch (status) {
    case 'page_cited':
      return 'target'
    case 'other_own_page':
      return 'other_page'
    case 'brand_mentioned':
    case 'not_cited':
      return 'not_cited'
    case 'no_aio':
      return 'no_overview'
    case 'error':
    case null:
      return 'not_checked'
  }
}

export function needsWork(result: SearchResult): boolean {
  return result === 'not_cited' || result === 'other_page'
}

export function emptyCounts(): Record<SearchResult, number> {
  return { not_cited: 0, other_page: 0, target: 0, no_overview: 0, not_checked: 0 }
}

export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100)
}

/** Totals from counts alone (no win odds): folders, topics from question rows. */
export function totalsOfCounts(counts: ResultCounts): Totals {
  const searches = SEARCH_RESULTS.reduce((sum, result) => sum + counts[result], 0)
  const withAio = counts.not_cited + counts.other_page + counts.target
  return {
    searches,
    counts,
    withAio,
    targetPct: percent(counts.target, withAio),
    needsWork: counts.not_cited + counts.other_page,
    winMax: null,
    winAvg: null
  }
}

export function totalsOf(searches: readonly Search[]): Totals {
  const counts = emptyCounts()
  const odds: number[] = []
  for (const search of searches) {
    counts[search.result] += 1
    if (needsWork(search.result) && search.winOdds !== null) odds.push(search.winOdds)
  }
  return {
    ...totalsOfCounts(counts),
    winMax: odds.length === 0 ? null : Math.max(...odds),
    winAvg:
      odds.length === 0
        ? null
        : Math.round(odds.reduce((sum, value) => sum + value, 0) / odds.length)
  }
}

/** Adds totals up (folder from topics). Win odds keep the best; the average is dropped. */
export function addTotals(items: readonly Totals[]): Totals {
  const counts = emptyCounts()
  let winMax: number | null = null
  for (const item of items) {
    for (const result of SEARCH_RESULTS) counts[result] += item.counts[result]
    if (item.winMax !== null) winMax = winMax === null ? item.winMax : Math.max(winMax, item.winMax)
  }
  return { ...totalsOfCounts(counts), winMax }
}

/** The results a bar, legend or grid shows: the four always, Not checked only when some. */
export function shownResults(counts: ResultCounts): readonly SearchResult[] {
  return SEARCH_RESULTS.filter((result) => result !== 'not_checked' || counts.not_checked > 0)
}

/** Win odds first (best first, none last), then Q before K, then number. */
export function compareSearches(a: Search, b: Search): number {
  const odds = (b.winOdds ?? -1) - (a.winOdds ?? -1)
  if (odds !== 0) return odds
  if (a.kind !== b.kind) return a.kind === 'question' ? -1 : 1
  return a.number - b.number
}
