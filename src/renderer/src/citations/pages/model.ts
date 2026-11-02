import { rollupPageFixes, type FixSearch, type PageFixRollup } from '@shared/page-fixes'
import { pagesView, type PagesView } from '@shared/pages-view'
import { targetPageKey } from '@shared/target-page'

/**
 * Citations · Pages (TopicPages.dc.html, for the whole project): every search
 * of the project seen from the pages side. Your pages (target pages, then your
 * other pages Google cites), the sites cited instead of you, and the searches
 * that need no page. Pure, so the footer is checked to add up.
 */

export type PagesSection = 'yours' | 'instead' | 'none'

export const SECTION_LABEL: Readonly<Record<PagesSection, string>> = {
  yours: 'Your pages',
  instead: 'Cited instead of you',
  none: 'No page needed'
}

export const SECTIONS: readonly PagesSection[] = ['yours', 'instead', 'none']

/** One line of the Pages view. */
export interface PagesRow {
  /** Opaque in the URL: a kind and a page key or a domain. */
  key: string
  section: PagesSection
  kind: 'target' | 'other' | 'new' | 'site' | 'noAio' | 'notChecked'
  /** A page's address, or a site's domain, or null for a summary line. */
  url: string | null
  domain: string | null
  pageId: string | null
  /** Searches citing it (a page), cited for (a site), or counted (no AI Overview, not checked). */
  citedFor: readonly FixSearch[]
  /** Searches aimed at the page that cite no page of yours yet; a new page's searches. */
  toWin: readonly FixSearch[]
  /** The What to fix entry this line leads to, when there is one. */
  fixId: string | null
}

export interface CitationPagesView {
  rows: readonly PagesRow[]
  view: PagesView
  rollup: PageFixRollup
}

function keyOf(url: string): string {
  return targetPageKey(url) ?? url.toLowerCase()
}

/** Builds the rows from every search of the project (`fixes:searches`). */
export function citationPages(searches: readonly FixSearch[]): CitationPagesView {
  const view = pagesView(searches)
  const rollup = rollupPageFixes(searches)
  const byId = new Map(searches.map((search) => [search.id, search]))
  const pick = (ids: readonly string[]): FixSearch[] =>
    ids.flatMap((id) => {
      const search = byId.get(id)
      return search ? [search] : []
    })
  // The fix each page leads to: improve its page, or pick the owner where it is cited instead.
  const fixFor = new Map<string, string>()
  for (const fix of rollup.fixes) {
    const url = fix.kind === 'owner' ? fix.citedUrl : fix.kind === 'improve' ? fix.page?.url : null
    if (url && !fixFor.has(keyOf(url))) fixFor.set(keyOf(url), fix.id)
  }
  const newFix = rollup.fixes.find((fix) => fix.kind === 'new') ?? null

  const rows: PagesRow[] = view.pages.map((page) => ({
    key: `${page.role}:${page.key}`,
    section: 'yours',
    kind: page.role,
    url: page.url,
    domain: null,
    pageId: page.pageId,
    citedFor: pick(page.citedFor),
    toWin: pick(page.toWin),
    fixId: fixFor.get(page.key) ?? null
  }))
  if (view.noPage.length > 0) {
    rows.push({
      key: 'new',
      section: 'yours',
      kind: 'new',
      url: null,
      domain: null,
      pageId: null,
      citedFor: [],
      toWin: pick(view.noPage),
      fixId: newFix?.id ?? null
    })
  }
  for (const site of view.sites) {
    rows.push({
      key: `site:${site.domain}`,
      section: 'instead',
      kind: 'site',
      url: null,
      domain: site.domain,
      pageId: null,
      citedFor: pick(site.searches),
      toWin: [],
      fixId: null
    })
  }
  if (view.noAio.length > 0) {
    rows.push({
      key: 'no-aio',
      section: 'none',
      kind: 'noAio',
      url: null,
      domain: null,
      pageId: null,
      citedFor: pick(view.noAio),
      toWin: [],
      fixId: null
    })
  }
  if (view.notChecked.length > 0) {
    rows.push({
      key: 'not-checked',
      section: 'none',
      kind: 'notChecked',
      url: null,
      domain: null,
      pageId: null,
      citedFor: pick(view.notChecked),
      toWin: [],
      fixId: null
    })
  }
  return { rows, view, rollup }
}

function n(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * "Your pages: 2 + 2 + 1 cited · 6 still to win · 3 need no page · 2 not checked
 * yet = 17 · one search can cite several other sites". The parts add up to every search.
 */
export function pagesFooter(view: PagesView): string {
  const cited = view.pages.filter((page) => page.citedFor.length > 0)
  const toWin = view.pages.reduce((sum, page) => sum + page.toWin.length, 0) + view.noPage.length
  const parts = [
    `Your pages: ${cited.length > 0 ? cited.map((page) => n(page.citedFor.length)).join(' + ') : '0'} cited`,
    `${n(toWin)} still to win`,
    `${n(view.noAio.length)} need no page`
  ]
  if (view.notChecked.length > 0) parts.push(`${n(view.notChecked.length)} not checked yet`)
  return `${parts.join(' · ')} = ${n(view.total)}`
}
