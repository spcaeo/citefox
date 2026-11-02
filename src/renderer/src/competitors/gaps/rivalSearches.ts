import type { CitedSiteRow, CompetitorGapQuestion, CompetitorLink } from '@shared/ipc'
import type { FixSearch } from '@shared/page-fixes'

/**
 * Every search whose latest overview cites a site, with where you stand there:
 * the rows behind the site's drawer. "They win" (cited, you're not) is the
 * drawer's first view; Both cited, All and Their pages (grouped by the site's
 * cited page) follow. Your result comes from the site's gaps (not cited) and
 * What to fix's searches (target or other page); win odds from the same.
 */

/** Where you stand on a search the site is cited for. `cited`: your site is cited, page not known. */
export type YouState = 'not_cited' | 'target' | 'other_page' | 'cited'

/** One search: a gap question's fields, plus your result and the win odds. */
export interface RivalSearch extends CompetitorGapQuestion {
  you: YouState
  /** 0–100. Null when What to fix has no odds for it. */
  winOdds: number | null
}

export const GAP_VIEWS = ['win', 'both', 'all', 'pages'] as const
export type GapView = (typeof GAP_VIEWS)[number]

export const GAP_VIEW_LABEL: Readonly<Record<GapView, string>> = {
  win: 'They win',
  both: 'Both cited',
  all: 'All',
  pages: 'Their pages'
}

/** The drawer's URL keys past `site`: the view, then the grid's own (`listUrlKeys('gap')`). */
export const GAP_QUERY = ['gv', 'gap.q', 'gap.sort', 'gap.p', 'gap.n'] as const

/** The route's view, or They win for a missing or unknown value. */
export function gapView(value: string | null): GapView {
  return GAP_VIEWS.find((view) => view === value) ?? 'win'
}

export function rivalSearches(
  row: Pick<CitedSiteRow, 'gaps' | 'links' | 'citedQuestions'>,
  searches: readonly FixSearch[]
): RivalSearch[] {
  const gaps = new Map(row.gaps.map((gap) => [gap.id, gap]))
  const best = new Map<string, CompetitorLink>()
  for (const link of row.links) {
    const id = `${link.pageId}|${link.promptId}`
    const found = best.get(id)
    if (found === undefined || link.position < found.position) best.set(id, link)
  }
  const bySearch = new Map(
    searches.map((search) => [`${search.sourceId}|${search.promptId}`, search])
  )
  const out: RivalSearch[] = []
  const seen = new Set<string>()
  for (const ref of row.citedQuestions) {
    if (ref.links === 0 || seen.has(ref.id)) continue
    seen.add(ref.id)
    const gap = gaps.get(ref.id)
    const search = bySearch.get(ref.id)
    const link = best.get(ref.id)
    out.push({
      id: ref.id,
      pageId: ref.pageId,
      pageKind: ref.pageKind,
      pageLabel: ref.pageLabel,
      pageUrl: gap?.pageUrl ?? (ref.pageKind === 'page' ? (search?.targetUrl ?? null) : null),
      promptId: ref.promptId,
      promptLabel: ref.promptLabel,
      promptText: ref.promptText,
      marketId: ref.marketId,
      marketIds: [...new Set([...ref.marketIds, ...(gap?.marketIds ?? [])])],
      runId: ref.runId,
      position: gap?.position ?? ref.position ?? link?.position ?? 0,
      url: gap?.url ?? link?.url ?? '',
      checkedAt: gap?.checkedAt ?? search?.checkedAt ?? null,
      you: gap ? 'not_cited' : youOf(search),
      winOdds: search?.winOdds?.score ?? null
    })
  }
  // A gap always has a cited question; one missing from it still shows.
  for (const gap of row.gaps) {
    if (seen.has(gap.id)) continue
    const search = bySearch.get(gap.id)
    out.push({ ...gap, you: 'not_cited', winOdds: search?.winOdds?.score ?? null })
  }
  return out
}

function youOf(search: FixSearch | undefined): YouState {
  if (search?.state === 'right_page') return 'target'
  if (search?.state === 'other_page') return 'other_page'
  return 'cited'
}

/** The rows of a view: They win is "you're not cited", Both cited the rest. */
export function inView(rows: readonly RivalSearch[], view: GapView): readonly RivalSearch[] {
  if (view === 'win') return rows.filter((row) => row.you === 'not_cited')
  if (view === 'both') return rows.filter((row) => row.you !== 'not_cited')
  return rows
}

/** How many rows each view holds, and how many different pages of theirs are cited. */
export function viewCounts(rows: readonly RivalSearch[]): Record<GapView, number> {
  const win = rows.filter((row) => row.you === 'not_cited').length
  return {
    win,
    both: rows.length - win,
    all: rows.length,
    pages: new Set(rows.map((row) => row.url).filter(Boolean)).size
  }
}

/** `/us/sms/email-to-sms/` for a full URL. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

/** `clicksend.com/us/sms/email-to-sms/`: their page without the protocol or `www.`. */
export function bareUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host.replace(/^www\./u, '')}${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}
