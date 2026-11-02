import { TOPIC_STAGE_LABEL, TOPIC_STAGES } from '@shared/domain'
import type { Search, SearchFilter } from './types'

/**
 * The Pages view (for writers): which own page wins what, what the target page still
 * has to win, the sites Google cites instead, and the searches that need no page.
 *
 * The sum that holds: every own page's "cited for" + "still to win" + "no page needed"
 * + "not checked yet" = all searches. Sites cited instead overlap (one search can cite
 * several), so they are not part of that sum.
 */

export type PageRole = 'target' | 'other'

export interface PageBreakdown {
  /** A stage key, `none`, or `keywords`. */
  id: string
  label: string
  cited: number
  toWin: number
  filter: SearchFilter
}

export interface OwnPageRow {
  /** The full URL; null for searches whose target page is not set yet. */
  url: string | null
  role: PageRole
  /** Searches whose answer cites this page. */
  citedFor: number
  /** Not-cited searches this page should win (target pages only). */
  stillToWin: number
  /** By stage, then Keywords, for the target page's open row. */
  breakdown: readonly PageBreakdown[]
  filter: SearchFilter
}

export interface SiteRow {
  domain: string
  /** Searches whose answer cites this site instead of you. */
  searches: number
  filter: SearchFilter
}

export interface PagesView {
  /** Target pages first (most to win first), then other own pages, most cited first. */
  pages: readonly OwnPageRow[]
  sites: readonly SiteRow[]
  noAio: number
  notChecked: number
  /** Footer sum parts. */
  cited: number
  stillToWin: number
  total: number
}

function breakdownOf(searches: readonly Search[], url: string | null): PageBreakdown[] {
  const mine = searches.filter(
    (search) =>
      (url !== null && search.pageCited === url) ||
      (search.result === 'not_cited' && search.targetUrl === url)
  )
  const part = (
    id: string,
    label: string,
    list: readonly Search[],
    filter: SearchFilter
  ): PageBreakdown => ({
    id,
    label,
    cited: list.filter((search) => search.result === 'target' || search.result === 'other_page')
      .length,
    toWin: list.filter((search) => search.result === 'not_cited').length,
    filter
  })
  const rows: PageBreakdown[] = []
  const questions = mine.filter((search) => search.kind === 'question')
  for (const stage of TOPIC_STAGES) {
    const list = questions.filter((search) => search.stage === stage)
    if (list.length > 0)
      rows.push(part(stage, TOPIC_STAGE_LABEL[stage], list, { stage, kind: 'question' }))
  }
  const loose = questions.filter((search) => search.stage === null)
  if (loose.length > 0)
    rows.push(part('none', 'No stage', loose, { stage: 'none', kind: 'question' }))
  const keywords = mine.filter((search) => search.kind === 'keyword')
  if (keywords.length > 0) rows.push(part('keywords', 'Keywords', keywords, { kind: 'keyword' }))
  return rows
}

export function pagesView(searches: readonly Search[]): PagesView {
  // An own page is a target page when a search is cited from it as its target, or when a
  // not-cited search aims at it.
  const cited = new Map<string, { role: PageRole; count: number }>()
  for (const search of searches) {
    if (!search.pageCited) continue
    const entry = cited.get(search.pageCited) ?? { role: 'other' as PageRole, count: 0 }
    entry.count += 1
    if (search.result === 'target') entry.role = 'target'
    cited.set(search.pageCited, entry)
  }
  const toWin = new Map<string | null, number>()
  for (const search of searches) {
    if (search.result !== 'not_cited') continue
    toWin.set(search.targetUrl, (toWin.get(search.targetUrl) ?? 0) + 1)
  }
  const urls = new Set<string | null>([...cited.keys(), ...toWin.keys()])
  const pages: OwnPageRow[] = [...urls].map((url) => {
    const entry = url === null ? undefined : cited.get(url)
    const stillToWin = toWin.get(url) ?? 0
    const role: PageRole = stillToWin > 0 || entry?.role === 'target' ? 'target' : 'other'
    return {
      url,
      role,
      citedFor: entry?.count ?? 0,
      stillToWin,
      breakdown: role === 'target' ? breakdownOf(searches, url) : [],
      filter: url === null ? { result: 'not_cited' } : { page: url }
    }
  })
  pages.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'target' ? -1 : 1
    if (a.url === null || b.url === null) return a.url === null ? 1 : -1
    const weight = (row: OwnPageRow): number => row.citedFor + row.stillToWin
    if (weight(a) !== weight(b)) return weight(b) - weight(a)
    return a.url < b.url ? -1 : 1
  })

  const siteCounts = new Map<string, number>()
  for (const search of searches) {
    for (const domain of new Set(search.citedInstead))
      siteCounts.set(domain, (siteCounts.get(domain) ?? 0) + 1)
  }
  const sites = [...siteCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([domain, count]) => ({ domain, searches: count, filter: { site: domain } }))

  const count = (result: Search['result']): number =>
    searches.filter((search) => search.result === result).length
  return {
    pages,
    sites,
    noAio: count('no_overview'),
    notChecked: count('not_checked'),
    cited: count('target') + count('other_page'),
    stillToWin: count('not_cited'),
    total: searches.length
  }
}
