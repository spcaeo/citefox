import { wordCount } from '../pipeline/hash'

/**
 * Word ranges in prompts guide Claude; they never fail a run over a small miss.
 *
 * - Within about 10% of the range (a 120–250 brief accepts 108–275 words) the reply
 *   is kept as it is: a 254-word brief is a good brief.
 * - Further out, the reply is asked for once more with the exact count named.
 * - Whatever comes back after that is kept; text still over the tolerant maximum is
 *   cut at the last sentence that fits ({@link trimToWords}).
 */

export interface WordRange {
  min: number
  max: number
}

/** How far outside a range a count may be before Claude is asked again (10%). */
export const WORD_TOLERANCE = 0.1

/** The range code accepts: about 10% wider on each side. */
export function tolerantRange(range: WordRange): WordRange {
  return {
    min: Math.floor(range.min * (1 - WORD_TOLERANCE)),
    max: Math.ceil(range.max * (1 + WORD_TOLERANCE))
  }
}

/** True when `words` is within the tolerant range. */
export function withinTolerance(words: number, range: WordRange): boolean {
  const accepted = tolerantRange(range)
  return words >= accepted.min && words <= accepted.max
}

/**
 * A check that names a word-count miss once. `shape` holds the problems that always
 * matter (a cause claim, a missing heading); `words` the count problem, which is
 * named on the first reply only. After that one retry, the count is never a reason
 * to fail: the caller trims what is still too long.
 */
export function wordsAskedOnce<T>(
  shape: (value: T) => string | null,
  words: (value: T) => string | null
): (value: T) => string | null {
  let asked = false
  return (value) => {
    const problem = shape(value)
    if (problem !== null) return problem
    if (asked) return null
    const count = words(value)
    if (count !== null) asked = true
    return count
  }
}

/**
 * `text` cut to at most `max` words, at the end of the last sentence that fits, with
 * its line breaks kept. Text within the limit comes back unchanged. When not even the
 * first sentence fits, it is cut at `max` words and ends with "…".
 */
export function trimToWords(text: string, max: number): string {
  if (wordCount(text) <= max) return text
  let best = -1
  const ends = /[.!?](?=["”’')\]]*(?:\s|$))/gu
  for (let match = ends.exec(text); match !== null; match = ends.exec(text)) {
    const end = match.index + 1
    if (wordCount(text.slice(0, end)) > max) break
    best = end
  }
  if (best > 0) return text.slice(0, best).trimEnd()
  return `${text.trim().split(/\s+/u).slice(0, max).join(' ')}…`
}
