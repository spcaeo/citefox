import type { CoverageMatrix } from '@shared/domain'
import type { StoredSnapshot } from '../../storage/content-records'
import { getLatestCoverage } from '../../storage/coverage-records'
import type { SqliteDatabase } from '../../storage/database'

/**
 * Code-side readers for the page assists (Docs/PROMPT-AUDIT.md P7, rule 4: code computes
 * what code can): the saved coverage matrix when it is current, checkable claims on the
 * page, verbatim-quote checks and search cut-off.
 */

/** The saved coverage matrix when it was written from this exact page content, else null. */
export function currentCoverage(
  db: SqliteDatabase,
  pageId: string,
  snapshot: Pick<StoredSnapshot, 'contentHash'>
): CoverageMatrix | null {
  const matrix = getLatestCoverage(db, pageId, snapshot.contentHash)
  if (matrix === null || matrix.stale || matrix.contentHash !== snapshot.contentHash) return null
  return matrix
}

/** Most claims sent to one online check. Each one can cost a search. */
export const MAX_CHECKED_CLAIMS = 10
const CLAIM_MIN_CHARS = 25
const CLAIM_MAX_CHARS = 280

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December'
/** Each signal is one kind of fact the web can confirm or refute. Limits come first. */
const CLAIM_SIGNALS: readonly RegExp[] = [
  // A technical limit: characters, segments, size, recipients.
  /\b\d[\d,.]*\s?(?:-\s?)?(?:characters?|chars|GSM|segments?|MB|KB|recipients?|contacts?)\b/iu,
  // A carrier gateway or a service being switched off.
  /(?:@?\b(?:vtext|txt\.att|tmomail|messaging\.sprintpcs|vzwpix|mms\.att)\b|\bshut(?:ting|s)? down\b|\bshutdown\b|\bdiscontinu\w+|\bdeprecat\w+|\bno longer (?:works?|supported|available)\b|\bsunset\w*)/iu,
  // A law, a registration or a carrier rule.
  /\b(?:TCPA|10DLC|A2P|CTIA|GDPR|CAN-SPAM|FCC|CRTC|Ofcom|HIPAA|toll-free verification|opt-?in|opt-?out|consent|registration|regulat\w*|compliance|fine[sd]?)\b/iu,
  // A price.
  /(?:[$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|cents?)\b|\bper (?:month|year|message|text)\b)/iu,
  // A date or a year.
  new RegExp(`\\b(?:${MONTHS})\\b|\\b(?:19|20)\\d{2}\\b`, 'u'),
  // Any other count with a unit: messages, credits, days, percent…
  /\b\d[\d,.]*\s?(?:-\s?)?(?:messages?|texts?|credits?|numbers?|days?|business days|hours?|minutes?|seconds?|weeks?|months?|years?|%|percent)\b/iu
]

/**
 * Sentences on the page that state a checkable fact (a limit, a gateway shutdown, a law,
 * a price, a date), at most `max`, returned in page order. The best claim of each kind
 * is taken in turn (the claim with the most signals first), so a wrong character limit
 * is never crowded out by price lines or repeats of one rule. Menu links, bylines and anything above the
 * H1 are skipped. Each is a short quote, so an online check never carries the page text.
 */
export function checkableClaims(
  snapshot: Pick<StoredSnapshot, 'bodyText' | 'faqs'>,
  max = MAX_CHECKED_CLAIMS
): string[] {
  const faqAnswers = snapshot.faqs.map((faq) => faq.answer)
  const sentences = [
    ...splitSentences(articleText(snapshot.bodyText)),
    ...faqAnswers.flatMap(splitSentences)
  ]
  const seen = new Set<string>()
  const claims: { text: string; signals: boolean[]; score: number; order: number }[] = []
  sentences.forEach((sentence, order) => {
    const text = plainText(sentence)
    if (text.length < CLAIM_MIN_CHARS || text.length > CLAIM_MAX_CHARS) return
    if (!/[a-z]{3}/iu.test(text) || BYLINE.test(text)) return
    const key = normalizeQuote(text)
    if (seen.has(key)) return
    const signals = CLAIM_SIGNALS.map((signal) => signal.test(text))
    const score = signals.filter(Boolean).length
    if (score === 0) return
    seen.add(key)
    claims.push({ text, signals, score, order })
  })
  const ranked = [...claims].sort(
    (left, right) => right.score - left.score || left.order - right.order
  )
  const picked = new Set<(typeof claims)[number]>()
  // Rounds over the kinds: the best unpicked claim of each kind, then the next best…
  while (picked.size < Math.min(max, claims.length)) {
    CLAIM_SIGNALS.forEach((_signal, kind) => {
      const best = ranked.find((claim) => claim.signals[kind] && !picked.has(claim))
      if (best !== undefined && picked.size < max) picked.add(best)
    })
  }
  return [...picked].sort((left, right) => left.order - right.order).map((claim) => claim.text)
}

/** "Last updated", "Published", "By …" lines: page furniture, not claims. */
const BYLINE =
  /^(?:image|source|photo|last updated|updated|last modified|modified|published|posted|written by|by)\b/iu

/**
 * The article: from the H1 down when the page has one (the menu sits above it), with
 * lines that are only a link (menus, related posts) removed.
 */
function articleText(bodyText: string): string {
  const lines = bodyText.split(/\n/u)
  const h1 = lines.findIndex((line) => /^#\s/u.test(line.trim()))
  return lines
    .slice(Math.max(h1, 0))
    .filter((line) => !LINK_ONLY.test(line))
    .join('\n')
}

const LINK_ONLY = /^\s*(?:[-*+•]|\d+[.)])?\s*\[[^\]]*\]\([^)]*\)[\s.,;:|]*$/u

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/u))
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Markdown links, emphasis, heading marks and list bullets removed; spaces collapsed. */
export function plainText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`]+/gu, '')
    .replace(/^\s*(?:#{1,6}|[-+•]|\d+[.)])\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Lower case, plain quotes and dashes, no markdown, single spaces, no end punctuation. */
export function normalizeQuote(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/[“”„″]/gu, '"')
    .replace(/[‘’′]/gu, "'")
    .replace(/[‐‑‒–—]/gu, '-')
    .replace(/^["'\s]+|["'.,;:!?\s]+$/gu, '')
}

/** True when `quote` appears on the page (body, head, outline or FAQs), ignoring markup. */
export function quotedFromPage(
  quote: string,
  snapshot: Pick<StoredSnapshot, 'bodyText' | 'title' | 'metaDescription' | 'h1' | 'faqs'>
): boolean {
  const needle = normalizeQuote(quote)
  if (needle.length === 0) return false
  const haystack = normalizeQuote(
    [
      snapshot.title ?? '',
      snapshot.metaDescription ?? '',
      snapshot.h1 ?? '',
      snapshot.bodyText,
      ...snapshot.faqs.flatMap((faq) => [faq.question, faq.answer])
    ].join('\n')
  )
  return haystack.includes(needle)
}

/** Where Google cuts a title or meta description in search results (characters). */
export const TITLE_CUT_OFF = 60
export const META_CUT_OFF = 155

/**
 * The words a searcher would not see when `text` is longer than `limit`, cut at the
 * last word that fits. Null when it fits.
 */
export function cutOffWords(text: string | null, limit: number): string | null {
  if (text === null) return null
  const clean = text.replace(/\s+/gu, ' ').trim()
  if (clean.length <= limit) return null
  const head = clean.slice(0, limit)
  const space = head.lastIndexOf(' ')
  const kept = space > limit * 0.6 ? head.slice(0, space) : head
  return clean.slice(kept.length).trim()
}
