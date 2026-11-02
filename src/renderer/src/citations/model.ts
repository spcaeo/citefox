import type { CitedOverviewRef, CitedPageRow, CitedQuestionRef, CitedWhose } from '@shared/ipc'
import { isCitedWhose } from '@shared/ipc'
import { patchHashQuery, readHashQuery } from '../utils/hashQuery'

/**
 * The project-wide Citations list (pure): every page the latest AI Overviews cite,
 * as pages or grouped by domain, filtered by whose it is. Every state is in the
 * route under `cit.*` (utils/queryState).
 */

export const CITED_QUERY = {
  /** `domains` groups the rows by domain; absent is pages. */
  by: 'cit.by',
  /** `yours`, `competitor` or `other`; absent is all. */
  whose: 'cit.whose',
  search: 'cit.q',
  sort: 'cit.sort',
  /** The expanded row's opaque id. */
  open: 'cit.open'
} as const

export type CitedView = 'pages' | 'domains'
export type WhoseFilter = 'all' | CitedWhose

export const WHOSE_LABELS: Readonly<Record<CitedWhose, string>> = {
  yours: 'Yours',
  competitor: 'Competitor',
  other: 'Other'
}

export const WHOSE_FILTERS: readonly { id: WhoseFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'yours', label: 'Yours' },
  { id: 'competitor', label: 'Competitors' },
  { id: 'other', label: 'Others' }
]

/** One line of the list: a cited page, or a domain with its cited pages. */
export interface CitedListRow {
  id: string
  kind: 'page' | 'domain'
  /** The page's address. Null on a domain row. */
  url: string | null
  /** The page's title when known. Null on a domain row. */
  title: string | null
  domain: string
  whose: CitedWhose
  competitor: string | null
  /** A page row: itself. A domain row: its cited pages. */
  pages: readonly CitedPageRow[]
  marketIds: readonly string[]
  questions: readonly CitedQuestionRef[]
  overviews: readonly CitedOverviewRef[]
}

export function viewFrom(value: string | null): CitedView {
  return value === 'domains' ? 'domains' : 'pages'
}

export function whoseFrom(value: string | null): WhoseFilter {
  return value !== null && isCitedWhose(value) ? value : 'all'
}

export function pageRow(row: CitedPageRow): CitedListRow {
  return {
    id: row.id,
    kind: 'page',
    url: row.url,
    title: row.title,
    domain: row.domain,
    whose: row.whose,
    competitor: row.competitor,
    pages: [row],
    marketIds: row.marketIds,
    questions: row.questions,
    overviews: row.overviews
  }
}

/**
 * The same rows grouped by domain. A question or an overview that cites two pages
 * of one domain counts once for the domain, at its best position.
 */
export function domainRows(rows: readonly CitedPageRow[]): CitedListRow[] {
  const groups = new Map<string, CitedPageRow[]>()
  for (const row of rows) {
    const list = groups.get(row.domainId) ?? []
    list.push(row)
    groups.set(row.domainId, list)
  }
  return [...groups.entries()].map(([id, pages]) => {
    const first = pages[0] as CitedPageRow
    const questions = new Map<string, CitedQuestionRef>()
    const overviews = new Map<string, CitedOverviewRef>()
    const markets = new Set<string>()
    for (const page of pages) {
      for (const market of page.marketIds) markets.add(market)
      for (const question of page.questions) {
        const found = questions.get(question.id)
        questions.set(
          question.id,
          found === undefined
            ? question
            : {
                ...found,
                marketIds: [...new Set([...found.marketIds, ...question.marketIds])],
                position: Math.min(found.position, question.position)
              }
        )
      }
      for (const overview of page.overviews) {
        const found = overviews.get(overview.id)
        if (found === undefined || overview.position < found.position) {
          overviews.set(overview.id, overview)
        }
      }
    }
    return {
      id,
      kind: 'domain' as const,
      url: null,
      title: null,
      domain: first.domain,
      whose: first.whose,
      competitor: first.competitor,
      pages,
      marketIds: [...markets],
      questions: [...questions.values()],
      overviews: [...overviews.values()]
    }
  })
}

export function listRows(rows: readonly CitedPageRow[], view: CitedView): CitedListRow[] {
  return view === 'domains' ? domainRows(rows) : rows.map(pageRow)
}

export function filterWhose(
  rows: readonly CitedListRow[],
  filter: WhoseFilter
): readonly CitedListRow[] {
  return filter === 'all' ? rows : rows.filter((row) => row.whose === filter)
}

export function whoseCounts(rows: readonly CitedListRow[]): Record<WhoseFilter, number> {
  const counts: Record<WhoseFilter, number> = {
    all: rows.length,
    yours: 0,
    competitor: 0,
    other: 0
  }
  for (const row of rows) counts[row.whose] += 1
  return counts
}

/** `example.com/pricing/`: the address without its scheme and `www.`, for a page with no title. */
export function shortAddress(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
}

/** What a row is called: the page's title, else its short address; a domain row's domain. */
export function rowName(row: CitedListRow): string {
  if (row.kind === 'domain' || row.url === null) return row.domain
  return row.title ?? shortAddress(row.url)
}

/** The Whose cell's text: a saved competitor by name. */
export function whoseText(row: Pick<CitedListRow, 'whose' | 'competitor'>): string {
  return row.whose === 'competitor' && row.competitor !== null
    ? row.competitor
    : WHOSE_LABELS[row.whose]
}

export function siteUrl(domain: string): string {
  return `https://${domain}/`
}

/**
 * Citations → "✦ Draft a pitch": for each other site's page, the questions whose
 * overview cites a competitor next to it and not you. Those are the pages worth a
 * pitch email. Keyed by row id, then question id (`pageId|promptId`).
 */
export function pitchQuestions(
  rows: readonly Pick<CitedPageRow, 'id' | 'whose' | 'questions' | 'overviews'>[]
): ReadonlyMap<string, ReadonlySet<string>> {
  const overviews = new Map<string, { competitor: boolean; yours: boolean }>()
  for (const row of rows) {
    if (row.whose === 'other') continue
    for (const overview of row.overviews) {
      const seen = overviews.get(overview.id) ?? { competitor: false, yours: false }
      if (row.whose === 'competitor') seen.competitor = true
      else seen.yours = true
      overviews.set(overview.id, seen)
    }
  }
  const found = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.whose !== 'other') continue
    const ids = new Set<string>()
    for (const question of row.questions) {
      const own = row.overviews.filter((overview) => overview.questionId === question.id)
      const seen = own.map((overview) => overviews.get(overview.id))
      if (seen.some((item) => item?.competitor) && !seen.some((item) => item?.yours)) {
        ids.add(question.id)
      }
    }
    if (ids.size > 0) found.set(row.id, ids)
  }
  return found
}

/**
 * A link carrying the List's own filters (`cit.whose=other`) but no view opens the
 * List, the view those filters belong to. Null when the link needs no change.
 */
export function citationsListLink(hash: string): string | null {
  const keys = Object.values(CITED_QUERY)
  const query = readHashQuery(['view', ...keys], hash)
  if (query.view || !keys.some((key) => query[key])) return null
  return patchHashQuery(hash, { view: 'list' })
}
