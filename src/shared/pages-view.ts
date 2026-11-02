/**
 * The Pages view (TopicPages.dc.html): a set of searches seen from the pages side.
 * Your pages first (target pages, then your other pages Google cites), each with
 * the searches it is cited for and the ones it still has to win; then the sites
 * cited instead of you; then the searches that need no page (no AI Overview).
 *
 * Pure and shared: a topic's Pages view passes its result rows, Citations passes
 * every search of the project (`fixes:searches`). Every search lands in exactly one
 * of cited-for, still-to-win, no page yet, no AI Overview or not checked, so
 * `pagesViewTotal` equals the number of rows. A search can count for several sites
 * in "cited instead", so the sites are not part of the total.
 */

import type { TopicRowState } from './domain'
import { targetPageKey } from './target-page'

/** What the Pages view reads from a row: a topic result row or a project search fits. */
export interface PagesViewRow {
  /** A topic result row's id in its topic. */
  promptId: string
  /** Set when prompt ids repeat (a project's searches: `sourceId|promptId`). Wins over `promptId`. */
  id?: string
  state: TopicRowState
  targetPageId: string | null
  targetUrl: string | null
  citedOwnUrl: string | null
  citedInstead: readonly string[]
}

export type PagesViewRole = 'target' | 'other'

/** One of your pages. */
export interface PagesViewPage {
  /** The page's key (host and path, lowercase): stable, never shown. */
  key: string
  url: string
  pageId: string | null
  /** `target`: some search should be cited from it. `other`: Google cites it, no search aims at it. */
  role: PagesViewRole
  /** Search ids (see `PagesViewRow.id`) citing this page (as the target, or instead of another target). */
  citedFor: readonly string[]
  /** Searches aimed at this page that cite no page of yours yet. */
  toWin: readonly string[]
}

/** Another site cited instead of you, with the searches it is cited for. */
export interface PagesViewSite {
  domain: string
  searches: readonly string[]
}

export interface PagesView {
  /** Target pages first (most searches first), then your other pages (most cited first). */
  pages: readonly PagesViewPage[]
  /** Not cited and no target page yet: a new page would win them. */
  noPage: readonly string[]
  /** Sites cited where no page of yours is (not cited, no page yet), most searches first. */
  sites: readonly PagesViewSite[]
  /** No page needed: Google answered without an AI Overview. */
  noAio: readonly string[]
  /** Failed or not checked yet. */
  notChecked: readonly string[]
  /** Rows read: the sum of every page's cited-for and to-win, no page, no AIO and not checked. */
  total: number
}

function keyOf(url: string): string {
  return targetPageKey(url) ?? url.toLowerCase()
}

interface Building {
  url: string
  pageId: string | null
  role: PagesViewRole
  citedFor: string[]
  toWin: string[]
}

/** Builds the Pages view from a set of rows. */
export function pagesView(rows: readonly PagesViewRow[]): PagesView {
  const pages = new Map<string, Building>()
  const page = (url: string, pageId: string | null, role: PagesViewRole): Building => {
    const key = keyOf(url)
    let found = pages.get(key)
    if (found === undefined) {
      found = { url, pageId, role, citedFor: [], toWin: [] }
      pages.set(key, found)
    }
    if (role === 'target') found.role = 'target'
    if (found.pageId === null && pageId !== null) found.pageId = pageId
    return found
  }
  // Every target is a target page, even one with nothing cited or to win yet.
  for (const row of rows) {
    if (row.targetUrl !== null) page(row.targetUrl, row.targetPageId, 'target')
  }
  const noPage: string[] = []
  const noAio: string[] = []
  const notChecked: string[] = []
  const sites = new Map<string, string[]>()
  for (const row of rows) {
    const id = row.id ?? row.promptId
    switch (row.state) {
      case 'right_page':
        page(row.targetUrl ?? row.citedOwnUrl ?? '', row.targetPageId, 'target').citedFor.push(id)
        break
      case 'other_page':
        page(row.citedOwnUrl ?? row.targetUrl ?? '', null, 'other').citedFor.push(id)
        break
      case 'not_cited':
      case 'no_page':
        if (row.targetUrl === null) noPage.push(id)
        else page(row.targetUrl, row.targetPageId, 'target').toWin.push(id)
        for (const domain of new Set(row.citedInstead)) {
          const list = sites.get(domain)
          if (list) list.push(id)
          else sites.set(domain, [id])
        }
        break
      case 'no_aio':
        noAio.push(id)
        break
      default:
        notChecked.push(id)
    }
  }
  const ordered = [...pages].map(([key, item]) => ({ key, ...item }))
  ordered.sort(
    (a, b) =>
      (a.role === 'target' ? 0 : 1) - (b.role === 'target' ? 0 : 1) ||
      b.citedFor.length + b.toWin.length - (a.citedFor.length + a.toWin.length) ||
      a.url.localeCompare(b.url, 'en')
  )
  return {
    pages: ordered,
    noPage,
    sites: [...sites]
      .map(([domain, searches]) => ({ domain, searches }))
      .sort((a, b) => b.searches.length - a.searches.length || a.domain.localeCompare(b.domain)),
    noAio,
    notChecked,
    total: rows.length
  }
}

/** Every search placed once: equals `total` (the footer's sum, asserted by the tests). */
export function pagesViewTotal(view: Omit<PagesView, 'total'>): number {
  let sum = view.noPage.length + view.noAio.length + view.notChecked.length
  for (const item of view.pages) sum += item.citedFor.length + item.toWin.length
  return sum
}

/** Cited-for and still-to-win summed over your pages: the footer's "72 + 29 + 9 cited · 96 to win". */
export function pagesViewCounts(view: PagesView): {
  cited: number
  toWin: number
  noPage: number
  noAio: number
  notChecked: number
} {
  let cited = 0
  let toWin = 0
  for (const item of view.pages) {
    cited += item.citedFor.length
    toWin += item.toWin.length
  }
  return {
    cited,
    toWin,
    noPage: view.noPage.length,
    noAio: view.noAio.length,
    notChecked: view.notChecked.length
  }
}
