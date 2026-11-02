import { hasAioState, isCitedState } from '@shared/topic-scoring'
import { MATCH_STATE_LABEL, type MatchState, type TopicPromptKind } from '@shared/domain'
import { targetPagePath } from '@shared/target-page'
import type { TopicResultRow, TopicResults } from '../types'

export { hasAioState, isCitedState }

/** True when an own-domain page is cited (§2: any own page counts). */
export function isCited(row: Pick<TopicResultRow, 'state'>): boolean {
  return isCitedState(row.state)
}

/** True when the search showed an AI Overview (the goal's denominator). */
export function hasAio(row: Pick<TopicResultRow, 'state'>): boolean {
  return hasAioState(row.state)
}

/**
 * The row's state in plain words: "Cited your site, but not the target page (/pricing)"
 * when another own page is cited, else the state's label.
 */
export function stateDetail(row: Pick<TopicResultRow, 'state' | 'targetUrl'>): string | null {
  if (row.state === 'other_page' && row.targetUrl) {
    return `Cited your site, but not the target page (${targetPagePath(row.targetUrl)})`
  }
  return MATCH_STATE_LABEL[row.state as MatchState] ?? null
}

/** "Q6" or "K12". */
export function promptLabel(row: Pick<TopicResultRow, 'kind' | 'number'>): string {
  return `${row.kind === 'question' ? 'Q' : 'K'}${row.number}`
}

/** Which kind the To-do and drawers lead with: questions when the topic has any. */
export function leadKind(results: Pick<TopicResults, 'topic'>): TopicPromptKind {
  return results.topic.questions > 0 || results.topic.keywords === 0 ? 'question' : 'keyword'
}

/** The rows of one kind. */
export function rowsOfKind(
  rows: readonly TopicResultRow[],
  kind: TopicPromptKind
): TopicResultRow[] {
  return rows.filter((row) => row.kind === kind)
}

/** Rows by prompt id, in the order of `ids` (unknown ids are skipped). */
export function rowsById(
  rows: readonly TopicResultRow[],
  ids: readonly string[]
): TopicResultRow[] {
  const byId = new Map(rows.map((row) => [row.promptId, row]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
}

/** A URL as a path for the grid (`/use-cases/it-alerts/`), or the text when it is not a URL. */
export function urlPath(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

/** Domains cited instead across rows, most frequent first. */
export function topDomains(
  rows: readonly Pick<TopicResultRow, 'citedInstead'>[],
  limit = 3
): { domain: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const domain of new Set(row.citedInstead)) {
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, limit)
}

/** Chip tone for a win-odds level. */
export function winTone(level: 'high' | 'medium' | 'low'): 'ok' | 'warn' | 'neutral' {
  if (level === 'high') return 'ok'
  if (level === 'medium') return 'warn'
  return 'neutral'
}
