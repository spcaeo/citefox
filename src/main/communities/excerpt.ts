import { THREAD_EXCERPT_MAX, THREAD_QUOTE_MAX } from '@shared/domain'
import { brandNamed } from '../engine/checks/classify'

/**
 * FR-17.4 extras from the public Reddit JSON that "Check threads" already
 * reads: a short excerpt (title and top post) and the sentence that names the
 * brand, so "Brand in thread?" can show where. Pure text work, no fetch.
 */

/** Title and top post, blank line between, whitespace tidied, trimmed to the limit. */
export function threadExcerpt(title: string | null, post: string | null): string | null {
  const parts = [tidy(title ?? ''), tidy(post ?? '')].filter((part) => part.length > 0)
  if (parts.length === 0) return null
  return trimText(parts.join('\n\n'), THREAD_EXCERPT_MAX)
}

/**
 * The first sentence naming a brand: the title and post first, then the
 * comments in order. Brand matching is the check classifier's (whole word,
 * case and accents folded). Null without brand names or a match.
 */
export function brandSentence(
  postParts: readonly string[],
  comments: readonly string[],
  brands: readonly string[]
): string | null {
  if (brands.every((brand) => brand.trim().length === 0)) return null
  for (const text of [...postParts, ...comments]) {
    if (!brandNamed(text, brands)) continue
    const sentence = splitSentences(text).find((part) => brandNamed(part, brands))
    if (sentence !== undefined) return quoteAround(sentence, brands)
  }
  return null
}

/** Sentences: split after `.`, `?` or `!` followed by a space, and at line breaks. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length > 0)
}

/** Text no longer than `max`, cut at a space where one is near, with an ellipsis. */
export function trimText(text: string, max: number): string {
  if (text.length <= max) return text
  const room = text.slice(0, max - 1)
  const space = room.lastIndexOf(' ')
  const cut = space >= max * 0.6 ? room.slice(0, space) : room
  return `${cut.replace(/[\s,;:]+$/u, '')}…`
}

/** A long sentence is cut to a window around the brand, with ellipses where it was cut. */
function quoteAround(sentence: string, brands: readonly string[]): string {
  if (sentence.length <= THREAD_QUOTE_MAX) return sentence
  const lower = sentence.toLowerCase()
  const at = brands
    .map((brand) => lower.indexOf(brand.trim().toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  if (at === undefined) return trimText(sentence, THREAD_QUOTE_MAX)
  const room = THREAD_QUOTE_MAX - 2
  const start = Math.max(0, Math.min(at - Math.floor(room / 3), sentence.length - room))
  const end = Math.min(sentence.length, start + room)
  const window = sentence.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${window}${end < sentence.length ? '…' : ''}`
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n')
}
