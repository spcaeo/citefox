/**
 * How two questions are compared for "Already tracked" (+ Add → Questions).
 * Case, punctuation, symbols and spacing are ignored, so "What replaced vtext?"
 * and "what replaced  VTEXT" are the same question. Main and the renderer share
 * this so the dialog and `prompts:addQuestions` agree on what a duplicate is.
 */
export function normaliseQuestion(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The lines of a "one per line" box, trimmed, blank lines left out. */
export function questionLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line.length > 0)
}

/** Words that never make two questions different: articles and "any". */
const MERGE_DROP = new Set(['a', 'an', 'the', 'any'])

/** A year from 1900 to 2099 on its own ("best gateway 2026"). */
const YEAR = /^(19|20)\d{2}$/u

/** A simple plural back to its singular: "gateways" → "gateway", "companies" → "company". */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/u.test(word)) return word.slice(0, -1)
  return word
}

/**
 * The near-duplicate key of a question: lower case, accents folded, punctuation and
 * spacing collapsed, years and the words a, an, the and any dropped, simple plurals
 * made singular. Word order is kept, so "email to SMS" and "SMS to email" stay apart.
 * Two questions with the same key are the same question in a slightly different
 * wording: the importer merges them, and + Add skips the second one.
 */
export function questionMergeKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0 && !MERGE_DROP.has(word) && !YEAR.test(word))
    .map(singular)
    .join(' ')
}
