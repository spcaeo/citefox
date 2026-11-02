import { isOwnHost } from './own-site'

/**
 * Where an overview names the project: its brand names and aliases as whole words,
 * and its own domain (bare, www., subdomains when the project counts them, full
 * URLs). Pure and position-based, so the prompt page can mark the exact characters
 * in yellow and the check's "brand named" flag (FR-6.4) reads the same rule.
 */

/** What to look for: the project profile's brand names and its own site. */
export interface BrandLens {
  /** Brand names and aliases, as the project profile lists them. */
  brandNames: readonly string[]
  /** The project's domain, such as "example.com". Empty when unknown. */
  ownDomain: string
  includeSubdomains: boolean
}

/** One marked run of the original text. `end` is exclusive. */
export interface TextMark {
  start: number
  end: number
  kind: 'brand' | 'domain'
}

/** A run of text, marked or not, in order. Joined, the runs are the original text. */
export interface MarkedRun {
  text: string
  marked: boolean
}

const WORD_CHAR = /[\p{L}\p{N}]/u
const SPACE = /\s/u
/** A host, with an optional scheme and path: "example.com", "https://www.example.com/pricing". */
const HOST_TOKEN =
  /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>"'`)\]]*)?/giu
/** Punctuation that ends a sentence, not a URL. */
const URL_TAIL = /[.,;:!?]+$/u

/** Folded text with, per folded character, the original span it came from. */
interface Folded {
  text: string
  from: number[]
  to: number[]
}

/**
 * Case and accents folded, whitespace runs as one space, so "Rêve" matches "reve".
 * Each code point folds on its own, so every folded character maps back to the
 * original characters it came from.
 */
function fold(value: string): Folded {
  let text = ''
  const from: number[] = []
  const to: number[] = []
  let at = 0
  let space = false
  for (const char of value) {
    const end = at + char.length
    if (SPACE.test(char)) {
      if (space) {
        to[to.length - 1] = end
      } else if (text.length > 0) {
        text += ' '
        from.push(at)
        to.push(end)
        space = true
      }
    } else {
      space = false
      const folded = char
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
      for (const piece of folded) {
        text += piece
        for (let index = 0; index < piece.length; index += 1) {
          from.push(at)
          to.push(end)
        }
      }
    }
    at = end
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    from.pop()
    to.pop()
  }
  return { text, from, to }
}

function foldNeedle(value: string): string {
  return fold(value).text
}

/** Every whole-word occurrence of `needle` (already folded) in the folded text. */
function wordHits(haystack: string, needle: string): Array<[number, number]> {
  const hits: Array<[number, number]> = []
  if (needle.length === 0) return hits
  const startsWord = WORD_CHAR.test(needle.charAt(0))
  const endsWord = WORD_CHAR.test(needle.charAt(needle.length - 1))
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack.charAt(at - 1)
    const after = haystack.charAt(at + needle.length)
    const openLeft = !startsWord || before === '' || !WORD_CHAR.test(before)
    const openRight = !endsWord || after === '' || !WORD_CHAR.test(after)
    if (openLeft && openRight) hits.push([at, at + needle.length])
  }
  return hits
}

/**
 * FR-6.4. Whole-word name matches, as spans of the original text. "Box" is not
 * named by "inbox", "Example" is not named by "Exampled", and "Example's"
 * marks "Example's". A name that starts or ends with punctuation ("AT&T",
 * "Booking.com") still matches on its letters.
 */
export function findNames(
  text: string,
  names: readonly string[]
): Array<{ start: number; end: number; name: string }> {
  const folded = fold(text)
  const found: Array<{ start: number; end: number; name: string }> = []
  for (const name of names) {
    const needle = foldNeedle(name)
    for (const [start, end] of wordHits(folded.text, needle)) {
      const from = folded.from[start]
      const to = folded.to[end - 1]
      if (from === undefined || to === undefined) continue
      found.push({ start: from, end: possessiveEnd(text, to), name })
    }
  }
  return found.sort((a, b) => a.start - b.start || b.end - a.end)
}

/** Extends a name over "'s" or "’s" when a word does not continue after it. */
function possessiveEnd(text: string, end: number): number {
  const tail = text.slice(end, end + 3)
  if (/^['’]s(?![\p{L}\p{N}])/u.test(tail)) return end + 2
  return end
}

/** FR-6.4. True when the text names any of the brands as a whole word. */
export function brandNamed(text: string | null, brands: readonly string[]): boolean {
  if (text === null) return false
  const folded = fold(text).text
  return brands.some((brand) => wordHits(folded, foldNeedle(brand)).length > 0)
}

interface HostToken {
  start: number
  end: number
  /** On the own site, by the same rule as the "Own page" classification. */
  own: boolean
}

/** Every host or URL in the text. */
function hostTokens(text: string, lens: BrandLens): HostToken[] {
  const tokens: HostToken[] = []
  for (const match of text.matchAll(HOST_TOKEN)) {
    const start = match.index
    const before = text.charAt(start - 1)
    if (before !== '' && (WORD_CHAR.test(before) || before === '.' || before === '-')) continue
    const token = match[0].replace(URL_TAIL, '')
    const host = token
      .replace(/^https?:\/\//iu, '')
      .replace(/[/:].*$/u, '')
      .toLowerCase()
      .replace(/^www\./u, '')
    const own =
      lens.ownDomain.trim().length > 0 && isOwnHost(host, lens.ownDomain, lens.includeSubdomains)
    tokens.push({ start, end: start + token.length, own })
  }
  return tokens
}

/**
 * Every brand and own-site mention, merged where they overlap (a domain wins).
 * Hosts and URLs follow the "Own page" rule; a brand name inside another site's
 * host ("example.co", or a subdomain the project does not count) is not marked.
 */
export function brandMarks(text: string, lens: BrandLens): TextMark[] {
  const hosts = hostTokens(text, lens)
  const foreign = hosts.filter((host) => !host.own)
  const names = findNames(text, lens.brandNames)
    .filter((hit) => !foreign.some((host) => inside(hit, host)))
    .map((hit): TextMark => ({ start: hit.start, end: hit.end, kind: 'brand' }))
  const domains = hosts
    .filter((host) => host.own)
    .map((host): TextMark => ({ start: host.start, end: host.end, kind: 'domain' }))
  const all = [...domains, ...names].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: TextMark[] = []
  for (const mark of all) {
    const last = merged[merged.length - 1]
    if (last !== undefined && mark.start < last.end) {
      last.end = Math.max(last.end, mark.end)
      if (mark.kind === 'domain') last.kind = 'domain'
      continue
    }
    merged.push({ ...mark })
  }
  return merged
}

/** True when the name is part of a longer host; a brand that is a host ("Booking.com") is not. */
function inside(hit: { start: number; end: number }, host: HostToken): boolean {
  const overlaps = hit.start < host.end && hit.end > host.start
  return overlaps && (host.start < hit.start || host.end > hit.end)
}

/** The text cut into marked and plain runs. No marks gives one plain run. */
export function markRuns(text: string, marks: readonly TextMark[]): MarkedRun[] {
  const runs: MarkedRun[] = []
  let cursor = 0
  for (const mark of marks) {
    if (mark.start < cursor || mark.end <= mark.start) continue
    if (mark.start > cursor) runs.push({ text: text.slice(cursor, mark.start), marked: false })
    runs.push({ text: text.slice(mark.start, mark.end), marked: true })
    cursor = mark.end
  }
  if (cursor < text.length || runs.length === 0) {
    runs.push({ text: text.slice(cursor), marked: false })
  }
  return runs
}

/** Shorthand: the text in runs, marked wherever it names the brand or the own site. */
export function brandRuns(text: string, lens: BrandLens | null): MarkedRun[] {
  if (lens === null) return [{ text, marked: false }]
  return markRuns(text, brandMarks(text, lens))
}
