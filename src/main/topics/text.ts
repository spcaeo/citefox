import type { TopicPromptFlag, TopicPromptKind } from '@shared/domain'
import { brandNamed } from '../engine/checks/classify'
import { parseRows } from '../import/csv'

/**
 * Text rules for topic questions and keywords: brand detection (the same
 * whole-word match checks use), short/long flags, overlap and near-duplicate
 * detection, and CSV parsing for "My own questions". Pure.
 */

/** Google reads at most 32 words. */
export const MAX_QUESTION_WORDS = 32
/** A question under this many words is flagged "Very short" but kept. */
export const SHORT_QUESTION_WORDS = 4

export function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}

/** True when the text names the brand or one of its aliases (whole word, case and accents folded). */
export function namesBrand(text: string, brands: readonly string[]): boolean {
  return brandNamed(text, brands)
}

export function promptFlags(
  text: string,
  kind: TopicPromptKind,
  brands: readonly string[]
): TopicPromptFlag[] {
  const flags: TopicPromptFlag[] = []
  if (namesBrand(text, brands)) flags.push('brand')
  if (kind === 'question') {
    const words = wordCount(text)
    if (words < SHORT_QUESTION_WORDS) flags.push('short')
    if (words > MAX_QUESTION_WORDS) flags.push('long')
  }
  return flags
}

const STOP = new Set(
  'a an and are as at be but by can do does for from how i if in is it its me my no not of on or our so than that the their them then there they this to us was we what when where which who why will with without you your'.split(
    ' '
  )
)

/** Lowercase, accents folded, punctuation dropped, whitespace squeezed. */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function contentTokens(text: string): string[] {
  return foldText(text)
    .split(' ')
    .filter((word) => word.length > 0 && !STOP.has(word))
    .map(stem)
}

export function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left)
  const b = new Set(right)
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** Key two lines share when they are the same question in other words or order. */
export function duplicateKey(text: string): string {
  return [...new Set(contentTokens(text))].sort().join(' ')
}

/** Questions that overlap: most of their content words are the same. */
export function overlapPairs(
  items: readonly { id: string; text: string }[],
  threshold = 0.6
): { a: string; b: string; score: number }[] {
  const tokens = items.map((item) => ({ id: item.id, tokens: contentTokens(item.text) }))
  const pairs: { a: string; b: string; score: number }[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = i + 1; j < tokens.length; j += 1) {
      const left = tokens[i]
      const right = tokens[j]
      if (left === undefined || right === undefined) continue
      const score = jaccard(left.tokens, right.tokens)
      if (score >= threshold) pairs.push({ a: left.id, b: right.id, score })
    }
  }
  return pairs
}

/**
 * Keyword near-duplicates: the same words in another order or number
 * ("email to sms service" / "email to sms services"), or one word apart in a
 * keyword of three or more words.
 */
export function nearDuplicateKeywords(
  items: readonly { id: string; text: string }[]
): { keepId: string; dropId: string; reason: string }[] {
  const out: { keepId: string; dropId: string; reason: string }[] = []
  const dropped = new Set<string>()
  const prepared = items.map((item) => ({ ...item, tokens: contentTokens(item.text) }))
  for (let i = 0; i < prepared.length; i += 1) {
    const left = prepared[i]
    if (left === undefined || dropped.has(left.id)) continue
    for (let j = i + 1; j < prepared.length; j += 1) {
      const right = prepared[j]
      if (right === undefined || dropped.has(right.id)) continue
      const sameSet = duplicateKey(left.text) === duplicateKey(right.text)
      const close =
        !sameSet &&
        left.tokens.length >= 3 &&
        right.tokens.length >= 3 &&
        jaccard(left.tokens, right.tokens) >= 0.75
      if (!sameSet && !close) continue
      dropped.add(right.id)
      out.push({
        keepId: left.id,
        dropId: right.id,
        reason: sameSet ? 'Same words in another order or number' : 'One word apart'
      })
    }
  }
  return out
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF, comma or semicolon. */
export function parseCsv(content: string): string[][] {
  // The shared importer's reader: comma or semicolon, guessed from the first lines.
  return parseRows(content, { candidates: [',', ';'] })
}

/** One cleaned import line. */
export interface CleanLine {
  text: string
  sourceNote: string | null
  mergedFrom: string[]
  flags: TopicPromptFlag[]
}

/**
 * Cleans pasted or CSV lines: trims bullets and numbering, merges duplicates
 * (same content words), flags brand names and very short lines (kept).
 */
export function cleanImportLines(
  lines: readonly { text: string; note: string | null }[],
  brands: readonly string[]
): { kept: CleanLine[]; duplicatesMerged: number } {
  const byKey = new Map<string, CleanLine>()
  let merged = 0
  for (const line of lines) {
    const text = line.text
      .replace(/^\s*(?:[-*•·]|\d+[.)])\s*/u, '')
      .replace(/\s+/gu, ' ')
      .trim()
    if (text.length === 0) continue
    const key = duplicateKey(text) || foldText(text)
    const existing = byKey.get(key)
    if (existing !== undefined) {
      merged += 1
      existing.mergedFrom.push(text)
      if (!existing.flags.includes('merged')) existing.flags.push('merged')
      continue
    }
    byKey.set(key, {
      text: text.slice(0, 500),
      sourceNote:
        line.note === null || line.note.trim().length === 0 ? null : line.note.trim().slice(0, 200),
      mergedFrom: [],
      flags: promptFlags(text, 'question', brands)
    })
  }
  return { kept: [...byKey.values()], duplicatesMerged: merged }
}
