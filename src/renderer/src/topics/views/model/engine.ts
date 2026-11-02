import type { EngineAnswerStatus, PromptCheckStatus } from '@shared/domain'
import type { QuestionEngineStatuses, QuestionResult, QuestionRow } from '@shared/ipc'
import { sameTargetPage } from '@shared/target-page'
import { ENGINE_PARAM, isAnswerFilter, type EngineFilter } from '../../../engines/model'
import { patchHashQuery } from '../../../utils/hashQuery'

/**
 * The Topics screens on one answer engine (audit #4). All and Google AI Overview keep
 * Google's results; ChatGPT, Perplexity and the rest re-count each question from that
 * engine's latest answer, by the same headline rule: target page cited, out of the
 * searches that got an answer (an answer stands where Google shows an AI Overview).
 */

/**
 * An answer's status as a check status. A cited answer is the target page when one of
 * the own pages it cites is the question's target, else another of your pages. Without
 * the pages (an older summary) it counts as cited, as the Questions screen counts it.
 */
export function checkStatusOnEngine(
  status: EngineAnswerStatus | undefined,
  ownUrls: readonly string[] | undefined,
  targetUrl: string | null
): PromptCheckStatus | null {
  switch (status) {
    case undefined:
      return null
    case 'cited':
      if (ownUrls === undefined || ownUrls.length === 0) return 'page_cited'
      return ownUrls.some((url) => sameTargetPage(url, targetUrl)) ? 'page_cited' : 'other_own_page'
    case 'named':
      return 'brand_mentioned'
    case 'not_cited':
      return 'not_cited'
    case 'no_answer':
      return 'no_aio'
    case 'unavailable':
    case 'error':
      return 'error'
  }
}

function resultOf(status: EngineAnswerStatus | undefined): QuestionResult {
  switch (status) {
    case undefined:
      return 'not_checked'
    case 'cited':
    case 'named':
    case 'not_cited':
      return status
    case 'no_answer':
      return 'no_overview'
    default:
      return 'error'
  }
}

function key(pageId: string, promptId: string): string {
  return `${pageId}\u0000${promptId}`
}

/**
 * Question rows as one answer engine saw them: status, overview (an answer), cited and
 * named from its latest answer; who it cited instead, tone and the change since the
 * check before are Google's only, so they are cleared. All and Google return the rows.
 */
export function rowsOnEngine(
  rows: readonly QuestionRow[],
  engine: EngineFilter,
  questions: readonly QuestionEngineStatuses[],
  marketId: string | null
): readonly QuestionRow[] {
  if (!isAnswerFilter(engine)) return rows
  const byQuestion = new Map<string, QuestionEngineStatuses>()
  for (const item of questions) {
    if (marketId !== null && item.marketId !== marketId) continue
    byQuestion.set(key(item.pageId, item.promptId), item)
  }
  return rows.map((row) => {
    // Where the question lives now, else where its latest check ran (a moved question).
    const found =
      byQuestion.get(key(row.sourceId, row.promptId)) ??
      (row.resultPageId === null
        ? undefined
        : byQuestion.get(key(row.resultPageId, row.resultPromptId ?? row.promptId)))
    const status = found?.statuses[engine]
    const answered = status === 'cited' || status === 'named' || status === 'not_cited'
    return {
      ...row,
      result: resultOf(status),
      status: checkStatusOnEngine(status, found?.ownUrls?.[engine], row.targetUrl),
      overview: answered ? true : status === 'no_answer' ? false : null,
      cited: answered ? status === 'cited' : null,
      named: answered ? status === 'named' : null,
      position: null,
      citedInstead: [],
      sentiment: null,
      change: 'none',
      previous: null
    }
  })
}

/** A link that keeps the picked engine (`?engine=chatgpt`), so it opens on the same results. */
export function withEngine(hash: string, engine: EngineFilter): string {
  return engine === 'all' ? hash : patchHashQuery(hash, { [ENGINE_PARAM]: engine })
}
