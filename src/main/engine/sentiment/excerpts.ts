import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { getLatestSnapshot, type StoredSnapshot } from '../../storage/snapshot-records'
import { fence } from '../../prompts/blocks'

/**
 * The own-page text the sentiment fact check sees (Docs/PROMPT-AUDIT.md, P6 4b): only
 * the passages of the brand's own pages that speak to the claims being checked, not
 * the whole page. Code picks them by the claim's words, numbers and theme, so a
 * pricing claim is checked against the pricing page's plan lines and a setup claim
 * against the steps that describe setup.
 */

/** A claim as the excerpt picker reads it. */
export interface ExcerptClaim {
  theme: string
  attribute: string
  sentence: string
}

/** One own page the picker may quote. */
export interface ExcerptPage {
  url: string
  title: string | null
  text: string
}

export interface OwnExcerpts {
  /** Fenced `<page_text>` block for `{{ own_pages }}`. */
  text: string
  /** URLs of the pages quoted, so a fact problem may name one to fix. */
  urls: string[]
  /** Passages quoted. 0 means no own page speaks to the claims. */
  passages: number
}

/** Longest passage, in characters. */
const PASSAGE_CHARS = 360
/** Passages kept per claim. */
const PER_CLAIM = 2
/** Passages kept in all. */
const MAX_PASSAGES = 8
/** A passage needs at least this score to be worth sending. */
const MIN_SCORE = 3
/** Other tracked pages read for passages, besides the checked page. */
const OTHER_PAGES = 30

const STOP = new Set(
  `a about above after again all also am an and any are as at be been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours get gets got use uses used using via per one two plus like make makes made way well much many may might must new`.split(
    /\s+/u
  )
)

/** The checked page's snapshot, then the latest snapshot of each other tracked page. */
export function ownPagesFor(
  db: SqliteDatabase,
  projectId: string,
  page: { id: string; url: string },
  snapshot: StoredSnapshot | null
): ExcerptPage[] {
  const pages: ExcerptPage[] = []
  if (snapshot !== null)
    pages.push({ url: page.url, title: snapshot.title, text: snapshot.bodyText })
  const others = listPages(db, projectId)
    .filter(
      (item) =>
        item.id !== page.id &&
        item.url !== null &&
        (item.status === 'tracked' || item.status === 'setting_up' || item.status === 'paused')
    )
    .slice(0, OTHER_PAGES)
  for (const other of others) {
    const latest = getLatestSnapshot(db, other.id)
    if (latest === null || other.url === null) continue
    pages.push({ url: other.url, title: latest.title ?? other.title, text: latest.bodyText })
  }
  return pages
}

/**
 * The passages that speak to the claims, grouped by page in page order and fenced.
 * `brandNames` are left out of the matching words: every own page names the brand.
 */
export function ownExcerpts(
  pages: readonly ExcerptPage[],
  claims: readonly ExcerptClaim[],
  brandNames: readonly string[]
): OwnExcerpts {
  const brand = new Set(brandNames.flatMap((name) => words(name)))
  const passages = pages.flatMap((page, pageIndex) =>
    split(page.text).map((text, index) => ({
      pageIndex,
      index,
      text,
      terms: new Set(words(text)),
      path: words(pathOf(page.url))
    }))
  )
  const kept = new Map<string, (typeof passages)[number]>()
  for (const claim of claims) {
    const weights = claimWeights(claim, brand)
    const theme = words(claim.theme)
    const ranked = passages
      .map((passage) => ({ passage, score: score(passage, weights, theme) }))
      .filter((item) => item.score >= MIN_SCORE)
      .sort((left, right) => right.score - left.score)
      .slice(0, PER_CLAIM)
    for (const { passage } of ranked) {
      if (kept.size >= MAX_PASSAGES) break
      kept.set(`${passage.pageIndex}:${passage.index}`, passage)
    }
  }
  const chosen = [...kept.values()].sort(
    (left, right) => left.pageIndex - right.pageIndex || left.index - right.index
  )
  const blocks: string[] = []
  const urls: string[] = []
  for (const [pageIndex, page] of pages.entries()) {
    const mine = chosen.filter((passage) => passage.pageIndex === pageIndex)
    if (mine.length === 0) continue
    urls.push(page.url)
    const head = `[${page.url}]${page.title === null ? '' : ` ${squash(page.title)}`}`
    blocks.push([head, ...mine.map((passage) => `… ${passage.text} …`)].join('\n'))
  }
  return {
    text: fence(
      'page_text',
      blocks.length === 0 ? 'No own page text speaks to these claims.' : blocks.join('\n\n')
    ),
    urls,
    passages: chosen.length
  }
}

/** Numbers weigh most (prices, limits, times), then the attribute, theme and sentence. */
function claimWeights(claim: ExcerptClaim, brand: ReadonlySet<string>): Map<string, number> {
  const weights = new Map<string, number>()
  const add = (text: string, weight: number): void => {
    for (const word of words(text)) {
      if (brand.has(word)) continue
      const value = /\d/u.test(word) ? 3 : weight
      weights.set(word, Math.max(weights.get(word) ?? 0, value))
    }
  }
  add(claim.sentence, 1)
  add(claim.theme, 1.5)
  add(claim.attribute, 2)
  return weights
}

function score(
  passage: { terms: ReadonlySet<string>; path: readonly string[] },
  weights: ReadonlyMap<string, number>,
  theme: readonly string[]
): number {
  let total = 0
  for (const [word, weight] of weights) if (passage.terms.has(word)) total += weight
  // A pricing claim reads the pricing page first, a setup claim the setup guide.
  if (total > 0 && theme.some((word) => passage.path.includes(word))) total += 2
  return total
}

/**
 * Lower-case words and numbers ("$29" → "29", "1,000" → "1000"), stop words dropped,
 * and a plural or third-person "s" cut, so "starts" meets "start" and "plans" "plan".
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(\d{3})/gu, '$1$2')
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/gu, ''))
    .filter((word) => word.length > 0 && (/\d/u.test(word) || (word.length > 2 && !STOP.has(word))))
    .map((word) => (word.length > 3 && /[^s]s$/u.test(word) ? word.slice(0, -1) : word))
}

/** Sentences joined into passages of at most {@link PASSAGE_CHARS} characters. */
function split(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map(squash)
    .filter((sentence) => sentence.length > 0)
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const piece =
      sentence.length > PASSAGE_CHARS ? `${sentence.slice(0, PASSAGE_CHARS - 1)}…` : sentence
    if (current.length > 0 && current.length + 1 + piece.length > PASSAGE_CHARS) {
      out.push(current)
      current = piece
    } else {
      current = current.length === 0 ? piece : `${current} ${piece}`
    }
  }
  if (current.length > 0) out.push(current)
  return out
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/[/_-]+/gu, ' ')
  } catch {
    return ''
  }
}

function squash(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}
