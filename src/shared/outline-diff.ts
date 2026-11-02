/**
 * Outline diff for "Lost ground": the headings of the page read before a drop, side by
 * side with the latest read. Headings are matched one to one by normalised text
 * similarity (a reworded heading still matches), so a section with no match on the
 * other side is one that was removed or added. Pure: same input, same output.
 */

import type { OutlineEntry } from './domain'

/** Two headings match at or above this similarity (0–1). */
export const HEADING_MATCH_THRESHOLD = 0.5

export interface OutlineHeading {
  level: 'h2' | 'h3'
  text: string
  /** Index of the matching heading on the other side. Null: no match there. */
  match: number | null
  /** Similarity with that match, 0–1. Null when unmatched. */
  similarity: number | null
}

export interface OutlineDiff {
  before: readonly OutlineHeading[]
  now: readonly OutlineHeading[]
  /** Headings before with no match now. */
  removed: number
  /** Headings now with no match before. */
  added: number
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'your',
  'you',
  'what',
  'how',
  'why'
])

/**
 * Lowercase, accents and punctuation off, a leading "1." or "Step 2:" off, spaces
 * collapsed. "3. Low-code vs No-code!" → "low code vs no code".
 */
export function normaliseHeading(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\s*(?:step\s+)?\d+[.):-]?\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokens(text: string): string[] {
  const words = normaliseHeading(text).split(' ').filter(Boolean)
  const kept = words.filter((word) => !STOP_WORDS.has(word))
  return (kept.length > 0 ? kept : words).map(stem)
}

/** A light plural and "-ing" trim, so "platforms" matches "platform" and "building" "build". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/**
 * Similarity of two headings, 0–1: the Dice coefficient of their word sets after
 * normalising, with 1 for headings that normalise to the same text.
 */
export function headingSimilarity(left: string, right: string): number {
  const a = normaliseHeading(left)
  const b = normaliseHeading(right)
  if (a.length === 0 || b.length === 0) return 0
  if (a === b) return 1
  const leftSet = new Set(tokens(left))
  const rightSet = new Set(tokens(right))
  if (leftSet.size === 0 || rightSet.size === 0) return 0
  let shared = 0
  for (const word of leftSet) if (rightSet.has(word)) shared += 1
  return (2 * shared) / (leftSet.size + rightSet.size)
}

function headings(outline: readonly OutlineEntry[]): { level: 'h2' | 'h3'; text: string }[] {
  const out: { level: 'h2' | 'h3'; text: string }[] = []
  for (const entry of outline) {
    if ((entry.level === 'h2' || entry.level === 'h3') && entry.text.trim().length > 0) {
      out.push({ level: entry.level, text: entry.text.trim() })
    }
  }
  return out
}

/**
 * Matches headings one to one, best pairs first (ties go to the pair closest in
 * position), keeping only pairs at or above `threshold`.
 */
export function diffOutline(
  before: readonly OutlineEntry[],
  now: readonly OutlineEntry[],
  threshold = HEADING_MATCH_THRESHOLD
): OutlineDiff {
  const left = headings(before)
  const right = headings(now)
  const pairs: { i: number; j: number; score: number; distance: number }[] = []
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      const score = headingSimilarity(left[i]?.text ?? '', right[j]?.text ?? '')
      if (score >= threshold) {
        const distance = Math.abs(i / Math.max(1, left.length) - j / Math.max(1, right.length))
        pairs.push({ i, j, score, distance })
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.distance - y.distance || x.i - y.i || x.j - y.j)
  const leftMatch = new Map<number, { j: number; score: number }>()
  const rightMatch = new Map<number, { i: number; score: number }>()
  for (const pair of pairs) {
    if (leftMatch.has(pair.i) || rightMatch.has(pair.j)) continue
    leftMatch.set(pair.i, { j: pair.j, score: pair.score })
    rightMatch.set(pair.j, { i: pair.i, score: pair.score })
  }
  const beforeRows = left.map((heading, index) => {
    const found = leftMatch.get(index)
    return {
      ...heading,
      match: found?.j ?? null,
      similarity: found === undefined ? null : round(found.score)
    }
  })
  const nowRows = right.map((heading, index) => {
    const found = rightMatch.get(index)
    return {
      ...heading,
      match: found?.i ?? null,
      similarity: found === undefined ? null : round(found.score)
    }
  })
  return {
    before: beforeRows,
    now: nowRows,
    removed: beforeRows.filter((row) => row.match === null).length,
    added: nowRows.filter((row) => row.match === null).length
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
