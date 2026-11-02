/**
 * Fixes · What to fix: every search that needs work, rolled up into PAGE fixes, so
 * the user fixes 64 pages instead of 1,310 searches. Pure: main sends the searches
 * (`fixes:searches`), the Fixes screen and the sidebar badge roll them up here.
 *
 * - Improve a page: the search's target page exists, and no page of yours is cited.
 * - Pick which page owns it: another page of yours is cited instead of the target.
 * - Write a new page: no page of yours is cited and the search has no target page.
 *
 * Nothing to do now: the target page is cited, or Google shows no AI Overview.
 * Failed searches and searches not checked yet are counted apart. Every search lands
 * in exactly one place, so the parts always add up to `total`.
 */

import type { TopicPromptKind, TopicRowState, WinOdds } from './domain'
import { targetPageKey } from './target-page'

/** Where a search comes from: a topic, or a tracked page (whose own URL is its target). */
export type FixSearchSourceKind = 'topic' | 'page'

/** One search (a question or keyword in its default market) as Fixes reads it. */
export interface FixSearch {
  /** `sourceId|promptId`, unique across the project. */
  id: string
  sourceKind: FixSearchSourceKind
  /** The topic's or tracked page's id. */
  sourceId: string
  /** The topic's name, or the page's label or path. */
  sourceName: string
  promptId: string
  marketId: string | null
  /** The check the result comes from. Null when not checked. */
  runId: string | null
  /** "Q6", "K3". */
  label: string
  kind: TopicPromptKind
  text: string
  state: TopicRowState
  targetPageId: string | null
  targetUrl: string | null
  /** Own URL cited (the target or another own page). Null when the own site is not cited. */
  citedOwnUrl: string | null
  /** Other sites cited, in position order, at most 5. */
  citedInstead: readonly string[]
  winOdds: WinOdds | null
  /** ISO-8601 UTC of the result. Null when not checked. */
  checkedAt: string | null
}

/** `fixes:searches`: every search of the project's topics and tracked pages. */
export interface ProjectSearches {
  projectId: string
  /** The project's own domain, for full URLs on copy and open. */
  domain: string
  /** ISO-8601 UTC. */
  builtAt: string
  /** Topics and tracked pages, in sidebar order, with a search or more. */
  sources: readonly { id: string; kind: FixSearchSourceKind; name: string }[]
  searches: readonly FixSearch[]
}

export const PAGE_FIX_KINDS = ['improve', 'owner', 'new'] as const
export type PageFixKind = (typeof PAGE_FIX_KINDS)[number]

export const PAGE_FIX_KIND_COPY: Readonly<
  Record<PageFixKind, { title: string; line: string; todo: string; action: string }>
> = {
  improve: {
    title: 'Improve a page',
    line: 'the page exists, Google picks others',
    todo: "add what Google's answer needs to the page you already chose.",
    action: 'Get fix brief'
  },
  owner: {
    title: 'Pick which page owns it',
    line: 'your other page is cited',
    todo: 'keep the page Google already likes, or point it at the target page.',
    action: 'Choose owner'
  },
  new: {
    title: 'Write a new page',
    line: 'no page of yours fits',
    todo: 'no page of yours fits these searches. Start one from a brief.',
    action: 'Get page brief'
  }
}

export function isPageFixKind(value: string | null): value is PageFixKind {
  return PAGE_FIX_KINDS.some((kind) => kind === value)
}

/** A topic or tracked page a fix's searches come from, with how many. */
export interface PageFixSource {
  id: string
  kind: FixSearchSourceKind
  name: string
  searches: number
}

/** One page fix: a page to improve, an owner to pick, or a page to write. */
export interface PageFix {
  /** Opaque and stable while the page and topics stay the same (safe in a URL). */
  id: string
  kind: PageFixKind
  /** The target page. Null for a new page, and for an owner fix with no target yet. */
  page: { pageId: string | null; url: string } | null
  /** Pick which page owns it: your page Google cites instead. */
  citedUrl: string | null
  /** Write a new page: the page to write, named after its topic. */
  proposed: string | null
  /** Most searches first. */
  sources: readonly PageFixSource[]
  /** Highest win odds first. */
  searches: readonly FixSearch[]
  /** Highest and mean win odds of its searches. Null when none has odds. */
  bestOdds: number | null
  avgOdds: number | null
}

export interface PageFixRollup {
  /** Grouped by kind (Improve, Owner, New), most searches first in each. */
  fixes: readonly PageFix[]
  byKind: Readonly<Record<PageFixKind, { fixes: number; searches: number }>>
  /** Searches in a fix. */
  needWork: number
  /** Nothing to do now. */
  targetCited: readonly FixSearch[]
  noAio: readonly FixSearch[]
  /** Failed or not checked yet: no fix until a check answers. */
  notChecked: readonly FixSearch[]
  /** Every search: needWork + targetCited + noAio + notChecked. */
  total: number
}

/** The kind of fix a search needs, or null when it needs none now. */
export function fixKindOf(search: Pick<FixSearch, 'state' | 'targetUrl'>): PageFixKind | null {
  switch (search.state) {
    case 'not_cited':
      return search.targetUrl === null ? 'new' : 'improve'
    case 'no_page':
      return 'new'
    case 'other_page':
      return 'owner'
    default:
      return null
  }
}

/** FNV-1a, base 36: a short opaque id for a fix key (no URL goes into the route). */
export function opaqueId(key: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `pf${hash.toString(36)}`
}

function pageKey(url: string | null): string {
  return url === null ? '' : (targetPageKey(url) ?? url.toLowerCase())
}

function fixKey(
  search: Pick<FixSearch, 'sourceId' | 'targetUrl' | 'citedOwnUrl'>,
  kind: PageFixKind
): string {
  if (kind === 'new') return `new|${search.sourceId}`
  if (kind === 'owner') return `owner|${pageKey(search.targetUrl)}|${pageKey(search.citedOwnUrl)}`
  return `improve|${pageKey(search.targetUrl)}`
}

function oddsOf(search: Pick<FixSearch, 'winOdds'>): number | null {
  return search.winOdds?.score ?? null
}

/** Highest win odds first; searches with no odds last, then by label. */
export function byOdds(left: FixSearch, right: FixSearch): number {
  const a = oddsOf(left)
  const b = oddsOf(right)
  if (a !== b) return (b ?? -1) - (a ?? -1)
  return left.label.localeCompare(right.label, 'en', { numeric: true })
}

function oddsStats(searches: readonly FixSearch[]): { best: number | null; avg: number | null } {
  const scores = searches.map(oddsOf).filter((score): score is number => score !== null)
  if (scores.length === 0) return { best: null, avg: null }
  return {
    best: Math.max(...scores),
    avg: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
  }
}

function sourcesOf(searches: readonly FixSearch[]): PageFixSource[] {
  const out = new Map<string, PageFixSource>()
  for (const search of searches) {
    const found = out.get(search.sourceId)
    if (found) found.searches += 1
    else {
      out.set(search.sourceId, {
        id: search.sourceId,
        kind: search.sourceKind,
        name: search.sourceName,
        searches: 1
      })
    }
  }
  return [...out.values()].sort(
    (a, b) => b.searches - a.searches || a.name.localeCompare(b.name, 'en')
  )
}

/** Builds one fix from its searches (all of one key). */
export function makeFix(key: string, kind: PageFixKind, searches: readonly FixSearch[]): PageFix {
  const sorted = [...searches].sort(byOdds)
  const first = sorted[0]
  const targetUrl = sorted.find((search) => search.targetUrl !== null)?.targetUrl ?? null
  const pageId = sorted.find((search) => search.targetPageId !== null)?.targetPageId ?? null
  const stats = oddsStats(sorted)
  return {
    id: opaqueId(key),
    kind,
    page: kind === 'new' || targetUrl === null ? null : { pageId, url: targetUrl },
    citedUrl: kind === 'owner' ? (first?.citedOwnUrl ?? null) : null,
    proposed: kind === 'new' ? (first?.sourceName ?? null) : null,
    sources: sourcesOf(sorted),
    searches: sorted,
    bestOdds: stats.best,
    avgOdds: stats.avg
  }
}

/** Most searches first, then the best odds, then the page. */
export function bySearches(left: PageFix, right: PageFix): number {
  return (
    right.searches.length - left.searches.length ||
    (right.bestOdds ?? -1) - (left.bestOdds ?? -1) ||
    fixName(left).localeCompare(fixName(right), 'en')
  )
}

/** The page path, the proposed page, or the cited page: the fix's name in a list. */
export function fixName(fix: Pick<PageFix, 'page' | 'proposed' | 'citedUrl'>): string {
  if (fix.page) return fix.page.url
  return fix.proposed ?? fix.citedUrl ?? ''
}

/**
 * The id of the page fix a search falls in (the same key the rollup uses), or null
 * when it needs no fix now. Other screens link to that fix's drawer with it.
 */
export function pageFixIdOf(
  search: Pick<FixSearch, 'state' | 'sourceId' | 'targetUrl' | 'citedOwnUrl'>
): string | null {
  const kind = fixKindOf(search)
  return kind === null ? null : opaqueId(fixKey(search, kind))
}

/** Rolls the searches up into page fixes. `sourceId` keeps one topic's or page's searches. */
export function rollupPageFixes(
  searches: readonly FixSearch[],
  sourceId: string | null = null
): PageFixRollup {
  const groups = new Map<string, { kind: PageFixKind; searches: FixSearch[] }>()
  const targetCited: FixSearch[] = []
  const noAio: FixSearch[] = []
  const notChecked: FixSearch[] = []
  let total = 0
  for (const search of searches) {
    if (sourceId !== null && search.sourceId !== sourceId) continue
    total += 1
    const kind = fixKindOf(search)
    if (kind === null) {
      if (search.state === 'right_page') targetCited.push(search)
      else if (search.state === 'no_aio') noAio.push(search)
      else notChecked.push(search)
      continue
    }
    const key = fixKey(search, kind)
    const group = groups.get(key)
    if (group) group.searches.push(search)
    else groups.set(key, { kind, searches: [search] })
  }
  const fixes = [...groups].map(([key, group]) => makeFix(key, group.kind, group.searches))
  fixes.sort(
    (a, b) => PAGE_FIX_KINDS.indexOf(a.kind) - PAGE_FIX_KINDS.indexOf(b.kind) || bySearches(a, b)
  )
  const byKind = {
    improve: { fixes: 0, searches: 0 },
    owner: { fixes: 0, searches: 0 },
    new: { fixes: 0, searches: 0 }
  }
  for (const fix of fixes) {
    byKind[fix.kind].fixes += 1
    byKind[fix.kind].searches += fix.searches.length
  }
  return {
    fixes,
    byKind,
    needWork: byKind.improve.searches + byKind.owner.searches + byKind.new.searches,
    targetCited,
    noAio,
    notChecked,
    total
  }
}

/**
 * A fix cut to one topic's or page's searches (the By topic view lists a fix under
 * each topic it serves, with that topic's searches only, so every group adds up).
 */
export function fixForSource(fix: PageFix, sourceId: string): PageFix {
  const searches = fix.searches.filter((search) => search.sourceId === sourceId)
  const stats = oddsStats(searches)
  return {
    ...fix,
    sources: fix.sources.filter((source) => source.id === sourceId),
    searches,
    bestOdds: stats.best,
    avgOdds: stats.avg
  }
}

/** The searches the sidebar badge counts as fixes to do: the number of page fixes. */
export function pageFixCount(searches: readonly FixSearch[]): number {
  return rollupPageFixes(searches).fixes.length
}
