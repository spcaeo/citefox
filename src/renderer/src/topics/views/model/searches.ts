import type { QuestionRow, QuestionSource, TopicResults } from '@shared/ipc'
import { needsWork, resultOfStatus, resultOfTopicState } from './results'
import type { Search, SearchFilter } from './types'

/**
 * Every search of a topic's latest check (or the pinned one), in the result language.
 * Nothing is dropped: searches with no AI Overview and unchecked ones are kept, so the
 * views add up to the topic's question and keyword count.
 */
export function searchesOfTopic(results: Pick<TopicResults, 'topic' | 'rows'>): Search[] {
  const { topic } = results
  return results.rows.map((row) => {
    const result = resultOfTopicState(row.state)
    return {
      id: row.promptId,
      ref: `${row.kind === 'question' ? 'Q' : 'K'}${row.number}`,
      number: row.number,
      kind: row.kind,
      text: row.text,
      stage: row.stage,
      result,
      citedInstead: row.citedInstead,
      pageCited: result === 'target' || result === 'other_page' ? row.citedOwnUrl : null,
      targetUrl: row.targetUrl ?? topic.targetPage,
      bestPage:
        row.matchReason === null
          ? null
          : {
              url: row.matchConfidence === null ? null : (row.aiPageUrl ?? row.targetUrl),
              fit: row.matchConfidence,
              reason: row.matchReason
            },
      winOdds:
        result === 'target' || result === 'no_overview' ? null : (row.winOdds?.score ?? null),
      sourceId: topic.id,
      sourceName: topic.name,
      checkedAt: row.checkedAt,
      live: result === 'not_checked' ? (row.live ?? null) : null
    }
  })
}

/**
 * The Questions screen's rows (every topic and page) as searches. Numbers run per
 * source and kind in list order, as a topic numbers its own questions and keywords.
 * Question rows carry no win odds. The cited page is the one Google cited (`citedOwnUrl`).
 */
export function searchesOfQuestions(
  rows: readonly QuestionRow[],
  sources: readonly QuestionSource[]
): Search[] {
  const byId = new Map(sources.map((source) => [source.id, source]))
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const key = `${row.sourceId}\u0000${row.promptKind}`
    const number = (seen.get(key) ?? 0) + 1
    seen.set(key, number)
    const result = resultOfStatus(row.status)
    return {
      id: row.promptId,
      ref: `${row.promptKind === 'question' ? 'Q' : 'K'}${number}`,
      number,
      kind: row.promptKind,
      text: row.text,
      stage: row.stage,
      result,
      citedInstead: row.citedInstead,
      // The page Google really cited, as a topic's rows carry it (`citedOwnUrl`), so a
      // page's "Cited for" is the same here as on the topic and Citations.
      pageCited:
        result === 'target'
          ? (row.citedOwnUrl ?? row.targetUrl)
          : result === 'other_page'
            ? (row.citedOwnUrl ?? null)
            : null,
      targetUrl: row.targetUrl,
      winOdds: null,
      sourceId: row.sourceId,
      sourceName: byId.get(row.sourceId)?.name ?? 'Unknown',
      sourceUrl: byId.get(row.sourceId)?.url ?? null,
      checkedAt: row.checkedAt
    }
  })
}

/** Keeps the searches every set key of the filter allows. `words` needs the word groups. */
export function filterSearches(
  searches: readonly Search[],
  filter: SearchFilter,
  wordGroupOf?: (search: Search) => string | null
): Search[] {
  return searches.filter((search) => {
    if (filter.kind && search.kind !== filter.kind) return false
    if (filter.result && search.result !== filter.result) return false
    if (filter.work && !needsWork(search.result)) return false
    if (filter.stage) {
      if (filter.stage === 'none' ? search.stage !== null : search.stage !== filter.stage)
        return false
    }
    if (filter.source && search.sourceId !== filter.source) return false
    if (filter.site && !search.citedInstead.includes(filter.site)) return false
    if (filter.page) {
      const owns = search.pageCited === filter.page
      const toWin = search.result === 'not_cited' && search.targetUrl === filter.page
      if (!owns && !toWin) return false
    }
    if (filter.words !== undefined) {
      if (!wordGroupOf || search.kind !== 'keyword' || wordGroupOf(search) !== filter.words)
        return false
    }
    return true
  })
}

/** Plain-text search over the wording and the Q/K number ("q12" finds Q12). */
export function matchText(searches: readonly Search[], query: string): Search[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...searches]
  return searches.filter(
    (search) => search.text.toLowerCase().includes(needle) || search.ref.toLowerCase() === needle
  )
}
