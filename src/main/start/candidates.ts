import type {
  SiteStartPage,
  SiteStartSection,
  StartPageKind,
  StartUrlSuggestion
} from '@shared/ipc'
import { START_MAX_PAGES, START_MIN_PAGES } from '@shared/site-start'
import { pathSegments, topFolderOf } from '../structure/cluster-rules'
import { isMoneyPage, slugTitle } from '../structure/url-rules'

/**
 * Pure rules for the first-run homework: what each sitemap page is (from its
 * address), the site's sections, the shortlist Claude picks from, and the
 * address-only picks used when Claude cannot be reached or picks too few.
 */

/** A sitemap page as the homework sees it. */
export interface StartPageRow {
  id: string
  url: string
  title: string | null
  tracked: boolean
}

const GUIDE_FOLDERS: readonly string[] = [
  'blog',
  'guides',
  'guide',
  'resources',
  'learn',
  'help',
  'docs',
  'faq',
  'articles'
]

const KIND_FOLDERS: ReadonlyArray<{ kind: StartPageKind; segments: readonly string[] }> = [
  { kind: 'pricing', segments: ['pricing', 'plans', 'price', 'prices'] },
  { kind: 'compare', segments: ['compare', 'comparison', 'comparisons', 'vs', 'versus'] },
  { kind: 'alternatives', segments: ['alternatives', 'alternative'] },
  {
    kind: 'use_case',
    segments: ['use-cases', 'use-case', 'usecases', 'solutions', 'industries', 'industry', 'for']
  },
  { kind: 'feature', segments: ['features', 'feature', 'product', 'products', 'platform'] },
  { kind: 'integration', segments: ['integrations', 'integration', 'apps', 'connect'] },
  { kind: 'guide', segments: GUIDE_FOLDERS }
]

/** What a page is, from its address alone. */
export function pageKind(url: string): StartPageKind {
  const segments = pathSegments(url).map((segment) => segment.toLowerCase())
  const slug = segments.at(-1) ?? ''
  if (segments.some((segment) => segment.includes('pricing'))) return 'pricing'
  // A blog post titled "x vs y" is a guide, not the site's own comparison page.
  if (GUIDE_FOLDERS.includes(segments[0] ?? '') && segments.length > 1) return 'guide'
  if (slug.includes('alternative')) return 'alternatives'
  if (slug.includes('-vs-') || slug.startsWith('vs-') || slug.endsWith('-vs')) return 'compare'
  for (const entry of KIND_FOLDERS) {
    if (segments.some((segment) => entry.segments.includes(segment))) return entry.kind
  }
  return 'other'
}

/** Order in which kinds matter most for a first AI Overview check. */
const KIND_RANK: Readonly<Record<StartPageKind, number>> = {
  pricing: 0,
  compare: 1,
  alternatives: 2,
  use_case: 3,
  feature: 4,
  integration: 5,
  other: 6,
  guide: 7
}

/** Most pages of each kind sent to Claude. */
const SHORTLIST_CAP: Readonly<Record<StartPageKind, number>> = {
  pricing: 5,
  compare: 40,
  alternatives: 30,
  use_case: 40,
  feature: 30,
  integration: 15,
  other: 30,
  guide: 20
}

export function pathOfUrl(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

function depth(url: string): number {
  return pathSegments(url).length
}

/** Shallow pages first, then short paths, then the address. */
function byShape(left: StartPageRow, right: StartPageRow): number {
  return (
    depth(left.url) - depth(right.url) ||
    pathOfUrl(left.url).length - pathOfUrl(right.url).length ||
    left.url.localeCompare(right.url)
  )
}

/** "Use cases" from `/use-cases`; "Top-level pages" for `/`. */
export function sectionLabel(folder: string): string {
  const words = folder
    .replace(/^\/+|\/+$/gu, '')
    .replace(/[-_]+/gu, ' ')
    .trim()
  if (words.length === 0) return 'Top-level pages'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The top folder (`/blog/`), or `/` for a top-level page. A folder's landing
 * page (`/features/`) joins that folder when `folders` holds it.
 */
export function sectionKeyOf(url: string, folders?: ReadonlySet<string>): string {
  const folder = topFolderOf(url)
  if (folder !== '/') return folder
  const segments = pathSegments(url)
  const own = segments.length === 1 ? `/${segments[0] ?? ''}/` : '/'
  return folders?.has(own) === true ? own : '/'
}

/** Top folders that hold at least one deeper page. */
export function folderSet(pages: readonly StartPageRow[]): Set<string> {
  const out = new Set<string>()
  for (const page of pages) {
    const folder = topFolderOf(page.url)
    if (folder !== '/') out.add(folder)
  }
  return out
}

/** The site's sections, biggest first, each with up to three sample pages. */
export function buildSections(pages: readonly StartPageRow[]): SiteStartSection[] {
  const groups = new Map<string, StartPageRow[]>()
  const folders = folderSet(pages)
  for (const page of pages) {
    const key = sectionKeyOf(page.url, folders)
    const list = groups.get(key) ?? []
    list.push(page)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: sectionLabel(key),
      pageCount: list.length,
      trackedCount: list.filter((page) => page.tracked).length,
      samples: [...list]
        .sort(
          (left, right) =>
            Number(isMoneyPage(right.url)) - Number(isMoneyPage(left.url)) || byShape(left, right)
        )
        .slice(0, 3)
        .map((page) => ({ url: page.url, title: page.title })),
      likely: 0,
      strongest: null
    }))
    .sort((left, right) => right.pageCount - left.pageCount || left.key.localeCompare(right.key))
}

/** Adds "likely to matter" counts and the strongest picked page to each section. */
export function annotateSections(
  sections: readonly SiteStartSection[],
  picks: readonly SiteStartPage[]
): SiteStartSection[] {
  return sections.map((section) => {
    const mine = picks.filter((page) => page.section === section.label)
    return { ...section, likely: mine.length, strongest: mine[0]?.path ?? null }
  })
}

/** The pages Claude chooses from: the likeliest of each kind, best kinds first. */
export function shortlist(pages: readonly StartPageRow[], max = 200): StartPageRow[] {
  const byKind = new Map<StartPageKind, StartPageRow[]>()
  for (const page of pages) {
    const kind = pageKind(page.url)
    const list = byKind.get(kind) ?? []
    list.push(page)
    byKind.set(kind, list)
  }
  const out: StartPageRow[] = []
  const kinds = [...byKind.keys()].sort((left, right) => KIND_RANK[left] - KIND_RANK[right])
  for (const kind of kinds) {
    const list = [...(byKind.get(kind) ?? [])].sort(byShape).slice(0, SHORTLIST_CAP[kind])
    out.push(...list)
  }
  return out.slice(0, max)
}

/** A bare competitor name from a domain or name: `simpletexting.com` → `simpletexting`. */
function competitorStem(competitor: string): string {
  return competitor
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/^www\./u, '')
    .replace(/\..*$/u, '')
    .replace(/[^a-z0-9]+/gu, '')
}

function flat(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

const RULE_REASON: Readonly<Record<StartPageKind, string>> = {
  pricing: 'Buyers ask AI Overviews what it costs; this page answers that directly.',
  compare: 'Comparison questions often get an AI Overview that cites side-by-side pages.',
  alternatives: 'Buyers searching for alternatives see overviews that list options.',
  use_case: 'A main use case page answers the "how do I…" questions buyers type.',
  feature: 'A core feature page explains what the product does in buyer words.',
  integration: 'Integration questions often get short overviews that cite how-to pages.',
  guide: 'A guide that answers a common question is easy for an overview to cite.',
  other: 'A top-level page buyers are likely to reach.'
}

/** A recommendation built from the address rules alone. */
export function rulePage(
  page: StartPageRow,
  sections: readonly SiteStartSection[],
  reason?: string,
  evidence?: string
): SiteStartPage {
  const kind = pageKind(page.url)
  const own = `/${pathSegments(page.url)[0] ?? ''}/`
  const section =
    sections.find((entry) => entry.key === sectionKeyOf(page.url)) ??
    sections.find((entry) => entry.key === own)
  return {
    url: page.url,
    path: pathOfUrl(page.url),
    title: page.title ?? slugTitle(page.url),
    pageId: page.id,
    kind,
    section: section?.label ?? sectionLabel(sectionKeyOf(page.url)),
    reason: reason ?? RULE_REASON[kind],
    evidence:
      evidence ??
      (section === undefined
        ? 'Listed in your sitemap.'
        : `Sitemap: ${section.label} section, ${section.pageCount} ${section.pageCount === 1 ? 'page' : 'pages'}.`),
    alreadyTracked: page.tracked,
    questionCount: 0
  }
}

/**
 * Address-only picks: pricing, a comparison with a named competitor (else the
 * first), an alternatives page, the main use case and the main feature page;
 * then the next shortlisted pages until there are at least three.
 */
export function rulePicks(
  pages: readonly StartPageRow[],
  sections: readonly SiteStartSection[],
  competitors: readonly string[],
  max = START_MAX_PAGES
): SiteStartPage[] {
  const list = shortlist(pages.filter((page) => !page.tracked))
  const of = (kind: StartPageKind): StartPageRow[] =>
    list.filter((page) => pageKind(page.url) === kind)
  const stems = competitors.map(competitorStem).filter((stem) => stem.length > 2)
  const compares = of('compare')
  const namedCompare = compares.find((page) =>
    stems.some((stem) => flat(pathOfUrl(page.url)).includes(stem))
  )
  const ordered: (StartPageRow | undefined)[] = [
    of('pricing')[0],
    namedCompare ?? compares[0],
    of('alternatives')[0],
    of('use_case')[0],
    of('feature')[0]
  ]
  const picked: StartPageRow[] = []
  const seen = new Set<string>()
  const add = (page: StartPageRow | undefined): void => {
    if (page === undefined || seen.has(page.url) || picked.length >= max) return
    seen.add(page.url)
    picked.push(page)
  }
  for (const page of ordered) add(page)
  for (const page of list) {
    if (picked.length >= START_MIN_PAGES) break
    add(page)
  }
  return picked.map((page) => rulePage(page, sections))
}

/**
 * Sitemap pages matching what the user typed, for the Add page address box:
 * path or title words first-match, money pages and shallow pages first.
 */
export function matchUrls(
  pages: readonly StartPageRow[],
  query: string,
  limit: number
): { suggestions: StartUrlSuggestion[]; total: number } {
  const raw = query.trim().toLowerCase()
  const needle = raw.replace(/^https?:\/\/[^/]+/u, '')
  const words = needle.split(/[^a-z0-9]+/u).filter((word) => word.length > 0)
  const scored: { page: StartPageRow; score: number }[] = []
  for (const page of pages) {
    const path = pathOfUrl(page.url).toLowerCase()
    const title = (page.title ?? '').toLowerCase()
    let score: number
    if (words.length === 0) {
      score = KIND_RANK[pageKind(page.url)] * 10
    } else {
      const hay = `${path} ${title}`
      if (!words.every((word) => hay.includes(word))) continue
      score = path.startsWith(needle) ? 0 : path.includes(needle) ? 10 : 20
      score += KIND_RANK[pageKind(page.url)]
    }
    scored.push({ page, score })
  }
  scored.sort((left, right) => left.score - right.score || byShape(left.page, right.page))
  const folders = folderSet(pages)
  return {
    total: scored.length,
    suggestions: scored.slice(0, limit).map(({ page }) => ({
      url: page.url,
      path: pathOfUrl(page.url),
      title: page.title ?? slugTitle(page.url),
      section: sectionLabel(sectionKeyOf(page.url, folders)),
      alreadyTracked: page.tracked
    }))
  }
}
