import { brandRuns, type BrandLens } from '@shared/brand-mentions'
import type { CitationClass } from '@shared/domain'
import { isOwnHost } from '@shared/own-site'
import { hostOf } from '../../ui/urlTextModel'

/** A source the check scored, from a Google sample or an engine answer. */
export interface ScoredSource {
  url: string
  domain: string
  classification: CitationClass
}

/** How a chip reads: the owner's site, a competitor's, or anyone else's. */
export type CiteKind = 'own' | 'competitor' | 'other'

/** Lines shown before "Show full answer", about what Google shows before its own "Show more". */
export const FOLD_LINES = 16
/** An answer only a few lines past the fold is shown whole. */
const FOLD_SLACK = 4
/** Characters on one line at the answer's ~72ch measure. */
const LINE_CHARS = 80

/**
 * Own, competitor or other for a cited URL: the scored source with the same
 * address first, then any scored source on the same site, then the own-site rule.
 */
export function citeKind(
  url: string,
  sources: readonly ScoredSource[],
  lens: BrandLens | null
): CiteKind {
  const key = urlKey(url)
  const host = hostOf(url)
  const exact = sources.find((source) => urlKey(source.url) === key)
  const sameSite = exact ?? sources.find((source) => host !== null && sameHost(source, host))
  if (sameSite) return kindOf(sameSite.classification)
  if (lens && host && isOwnHost(host, lens.ownDomain, lens.includeSubdomains)) return 'own'
  return 'other'
}

function kindOf(classification: CitationClass): CiteKind {
  if (classification === 'target' || classification === 'own') return 'own'
  return classification === 'competitor' ? 'competitor' : 'other'
}

function sameHost(source: ScoredSource, host: string): boolean {
  const own = hostOf(source.url) ?? source.domain.toLowerCase().replace(/^www\./, '')
  return own === host
}

/** An address without tracking tags, its fragment, or a trailing slash, for matching. */
function urlKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const name of [...parsed.searchParams.keys()]) {
      if (name.startsWith('utm_')) parsed.searchParams.delete(name)
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return `${host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
  } catch {
    return url
  }
}

/** Second-level labels under a country code: `co.uk`, `com.au`. */
const SHARED_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'])

/** The short site name a chip shows: `assets.nagios.com` reads `nagios.com`. */
export function siteName(url: string): string {
  const host = hostOf(url)
  if (host === null) return url
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const keep = SHARED_SECOND_LEVEL.has(labels[labels.length - 2] ?? '') ? 3 : 2
  return labels.slice(-keep).join('.')
}

/** Whether the answer folds after {@link FOLD_LINES}, and whether it starts open. */
export interface FoldPlan {
  foldable: boolean
  /** The brand or the own site shows up below the fold, so the whole answer shows. */
  startOpen: boolean
}

/**
 * Estimates the answer's height in lines from its markdown, so the fold is
 * decided before layout (and the same in tests). A link counts as its text.
 * The brand or an own-site link below the fold opens the answer: CiteFox never
 * hides where the owner is named or cited.
 */
export function foldPlan(
  markdown: string,
  sources: readonly ScoredSource[],
  lens: BrandLens | null
): FoldPlan {
  let lines = 0
  let firstOwnLine: number | null = null
  for (const raw of markdown.split('\n')) {
    if (raw.trim() === '') {
      lines += 0.5
      continue
    }
    if (firstOwnLine === null && mentionsOwner(raw, sources, lens)) firstOwnLine = lines
    const shown = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim()
    lines += Math.max(1, Math.ceil(shown.length / LINE_CHARS))
  }
  const foldable = lines > FOLD_LINES + FOLD_SLACK
  const startOpen = foldable && firstOwnLine !== null && firstOwnLine >= FOLD_LINES - 1
  return { foldable, startOpen }
}

function mentionsOwner(
  line: string,
  sources: readonly ScoredSource[],
  lens: BrandLens | null
): boolean {
  if (lens && brandRuns(line, lens).some((run) => run.marked)) return true
  for (const match of line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (match[1] && citeKind(match[1], sources, lens) === 'own') return true
  }
  return false
}
