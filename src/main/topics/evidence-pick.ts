import { contentTokens } from './text'

/**
 * Pure picking for `topicEvidence` (Docs/PROMPT-AUDIT.md, P3 item 0): which of the
 * site's own pages are about this topic, and which part of each page to quote.
 * Words are weighted by how rare they are across the site's pages, so a word every
 * page carries ("text", "alerts" on an SMS site) never picks a page on its own.
 */

/** A page the site has: tracked, in the sitemap, or read by Discover. */
export interface EvidenceCandidate {
  url: string
  title: string | null
  outline: readonly string[]
  /** Tracked pages first when scores tie. */
  tracked: boolean
}

/** What the topic is about: the seed weighs most, then the core terms. */
export interface EvidenceQuery {
  seed: string
  terms: readonly string[]
  /**
   * What the whole business does (the homepage title and H1). Its words describe
   * every page of the site, so they count a fifth and never pick a page alone.
   */
  generic?: readonly string[]
}

/** How much a word the homepage uses for the whole business counts. */
export const GENERIC_WEIGHT = 0.2

export interface ScoredCandidate {
  candidate: EvidenceCandidate
  score: number
  /** The query words the page matched, rarest first. */
  matched: string[]
}

/** A word in at most this share of the pages counts as specific to a topic. */
export const RARE_SHARE = 0.25

/** Paths that list other pages, never evidence on their own. */
const LISTING_PATH =
  /\/(?:tag|tags|category|categories|author|authors|page|feed|wp-json|search|cart|checkout|login|signin|sign-in|signup|sign-up|privacy|terms|legal|cookie|cookies)(?:\/|$)/iu

/** Path words of a URL: `/use-case/alarm-text-alerts/` gives `use case alarm text alerts`. */
export function pathWords(url: string): string {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = url
  }
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep the raw path.
  }
  return path.replace(/\.(?:html?|php|aspx?)$/iu, '').replace(/[/_\-.]+/gu, ' ')
}

/** True for the homepage and listing pages such as `/blog/`, `/tag/x/` or `/page/2/`. */
export function isListingUrl(url: string): boolean {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return true
  }
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return true
  if (LISTING_PATH.test(path)) return true
  return (
    parts.length === 1 && /^(?:blog|blogs|news|resources|articles|posts)$/iu.test(parts[0] ?? '')
  )
}

/** The weighted query words: the seed's at 1, the core terms' at 0.5. */
export function queryWeights(query: EvidenceQuery): Map<string, number> {
  const weights = new Map<string, number>()
  for (const token of contentTokens(query.seed)) {
    if (token.length > 1) weights.set(token, 1)
  }
  for (const term of query.terms) {
    for (const token of contentTokens(term)) {
      if (token.length > 1 && !weights.has(token)) weights.set(token, 0.5)
    }
  }
  return weights
}

/**
 * Scores each candidate against the query and keeps those that match at least one
 * specific word, best first. A word found in the URL counts 1.5 times one found
 * only in the title or headings.
 */
export function scoreCandidates(
  candidates: readonly EvidenceCandidate[],
  query: EvidenceQuery
): ScoredCandidate[] {
  const weights = queryWeights(query)
  if (weights.size === 0 || candidates.length === 0) return []
  const generic = new Set(contentTokens((query.generic ?? []).join(' ')))
  const pages = candidates
    .filter((candidate) => !isListingUrl(candidate.url))
    .map((candidate) => ({
      candidate,
      path: new Set(contentTokens(pathWords(candidate.url))),
      body: new Set(
        contentTokens([candidate.title ?? '', ...candidate.outline.slice(0, 20)].join(' '))
      )
    }))
  const total = pages.length
  if (total === 0) return []
  const share = new Map<string, number>()
  for (const token of weights.keys()) {
    const found = pages.filter((page) => page.path.has(token) || page.body.has(token)).length
    share.set(token, found / total)
  }
  const idf = (token: string): number => {
    const found = Math.round((share.get(token) ?? 0) * total)
    return Math.log((total + 1) / (found + 1))
  }
  const scored: ScoredCandidate[] = []
  for (const page of pages) {
    let score = 0
    const matched: string[] = []
    for (const [token, weight] of weights) {
      const inPath = page.path.has(token)
      if (!inPath && !page.body.has(token)) continue
      score += weight * idf(token) * (inPath ? 1.5 : 1) * (generic.has(token) ? GENERIC_WEIGHT : 1)
      matched.push(token)
    }
    const specific = matched.some(
      (token) => !generic.has(token) && (share.get(token) ?? 1) <= RARE_SHARE
    )
    if (!specific || score <= 0) continue
    matched.sort((a, b) => (share.get(a) ?? 1) - (share.get(b) ?? 1))
    scored.push({ candidate: page.candidate, score, matched })
  }
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.candidate.tracked) - Number(a.candidate.tracked) ||
      a.candidate.url.length - b.candidate.url.length
  )
}

/** Lines that are menus, link lists, images or boilerplate, not content. */
function isNoise(block: string): boolean {
  const text = block.trim()
  if (text.length === 0) return true
  if (/^!\[/u.test(text)) return true
  const withoutLinks = text
    .replace(/!?\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/[*_`>#|\-\s]+/gu, ' ')
    .trim()
  if (withoutLinks.length < 25 && !/^#{1,3}\s/u.test(text)) return true
  const links = (text.match(/\]\(/gu) ?? []).length
  return links >= 3 && withoutLinks.length < links * 30
}

/** Markdown links as their text, so quotes read as the page reads. */
function plain(block: string): string {
  return block
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * The part of a page most about the topic, at most `max` characters: its first
 * real paragraph, then the headings and paragraphs that use the query's words, in
 * page order. Menus, link lists and images are left out.
 */
export function relevantExcerpt(text: string, query: EvidenceQuery, max: number): string {
  const weights = queryWeights(query)
  const blocks = text
    .split(/\n{2,}|\n(?=#{1,4}\s)/u)
    .filter((block) => !isNoise(block))
    .map((block, index) => {
      const tokens = new Set(contentTokens(block))
      let score = 0
      for (const [token, weight] of weights) if (tokens.has(token)) score += weight
      return { index, text: plain(block), score }
    })
    .filter((block) => block.text.length > 0)
  if (blocks.length === 0) return ''
  const keep = new Set<number>()
  let used = 0
  const take = (block: { index: number; text: string }): void => {
    if (keep.has(block.index) || used >= max) return
    keep.add(block.index)
    used += block.text.length + 1
  }
  const firstParagraph = blocks.find((block) => !/^#/u.test(block.text) && block.text.length > 60)
  if (firstParagraph !== undefined) take(firstParagraph)
  for (const block of [...blocks].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (block.score <= 0) break
    take(block)
  }
  for (const block of blocks) take(block)
  const joined = blocks
    .filter((block) => keep.has(block.index))
    .map((block) => block.text)
    .join('\n')
  if (joined.length <= max) return joined
  const cut = joined.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
