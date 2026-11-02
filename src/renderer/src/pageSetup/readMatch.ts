import type { BuyerPrompt, CoverageMatrix } from '@shared/domain'

/**
 * Which buyer prompts use a part of the page or a part of the buyer profile.
 * The page read and the profile store no prompt links, so these match text:
 * the coverage matrix's "where covered" notes and each prompt's mapped page
 * element for page parts, and the prompt's label and wording for profile
 * parts. Every drill built from these ids lists exactly these ids, so its
 * total equals the number shown (NFR-14).
 */

const STOP = new Set([
  'about',
  'and',
  'any',
  'are',
  'can',
  'does',
  'for',
  'from',
  'get',
  'has',
  'have',
  'how',
  'into',
  'its',
  'not',
  'our',
  'should',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'through',
  'what',
  'when',
  'which',
  'who',
  'why',
  'will',
  'with',
  'without',
  'you',
  'your'
])

/** Lowercase, punctuation to spaces, single spaces. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function stem(word: string): string {
  return word.length > 5 ? word.slice(0, 5) : word
}

/** Significant word stems: 3+ letters, not a stop word. */
export function wordStems(text: string): Set<string> {
  const stems = new Set<string>()
  for (const word of normalizeText(text).split(' ')) {
    if (word.length >= 3 && !STOP.has(word)) stems.add(stem(word))
  }
  return stems
}

/**
 * True when `phrase` names the same thing as `text`: one contains the other,
 * or they share at least two significant words.
 */
export function phraseMatches(text: string, phrase: string): boolean {
  const a = normalizeText(text)
  const b = normalizeText(phrase)
  if (a.length === 0 || b.length === 0) return false
  const wa = ` ${a} `
  const wb = ` ${b} `
  if ((b.length >= 4 && wa.includes(wb)) || (a.length >= 4 && wb.includes(wa))) return true
  const left = wordStems(text)
  let shared = 0
  for (const word of wordStems(phrase)) {
    if (left.has(word)) shared += 1
    if (shared >= 2) return true
  }
  return false
}

/** The parts of a mapped element such as "Step 3 · Connect your tools, monitoring FAQ". */
function mappedParts(mapped: string): string[] {
  return mapped
    .split(/[,·;]/)
    .map((part) => part.replace(/^\s*h[1-6]\s+/i, '').trim())
    .filter((part) => part.length > 0)
}

function coverageNotes(matrix: CoverageMatrix | null): ReadonlyMap<string, readonly string[]> {
  const notes = new Map<string, readonly string[]>()
  for (const row of matrix?.rows ?? []) notes.set(row.promptId, row.whereCovered)
  return notes
}

/** Prompts whose coverage note or mapped element points at this heading. */
export function sectionPromptIds(
  heading: string,
  prompts: readonly BuyerPrompt[],
  matrix: CoverageMatrix | null
): string[] {
  const notes = coverageNotes(matrix)
  return prompts
    .filter((prompt) => {
      const places = [...(notes.get(prompt.id) ?? []), ...mappedParts(prompt.mappedElement)]
      return places.some((place) => phraseMatches(heading, place))
    })
    .map((prompt) => prompt.id)
}

/**
 * The word that names an FAQ in a note such as "monitoring FAQ" or
 * "Carrier FAQ (shutdown dates)": the last significant word before "FAQ".
 */
function faqQualifier(note: string): string | null {
  const words = normalizeText(note.replace(/\(.*?\)/g, ' ')).split(' ')
  const at = words.indexOf('faq')
  if (at <= 0) return null
  for (let index = at - 1; index >= 0; index -= 1) {
    const word = words[index] ?? ''
    if (word.length >= 3 && !STOP.has(word)) return stem(word)
  }
  return null
}

/** Prompts whose coverage note or mapped element points at this FAQ question. */
export function faqPromptIds(
  question: string,
  prompts: readonly BuyerPrompt[],
  matrix: CoverageMatrix | null
): string[] {
  const notes = coverageNotes(matrix)
  const stems = wordStems(question)
  return prompts
    .filter((prompt) => {
      const places = [...(notes.get(prompt.id) ?? []), ...mappedParts(prompt.mappedElement)]
      return places.some((place) => {
        const qualifier = faqQualifier(place)
        if (qualifier) return stems.has(qualifier)
        return phraseMatches(question, place)
      })
    })
    .map((prompt) => prompt.id)
}

/** The prompt's label and every market's wording, for matching profile parts. */
function promptText(prompt: BuyerPrompt): string {
  return [prompt.label, prompt.mappedElement, ...prompt.variants.map((v) => v.text)].join(' · ')
}

/** Prompts that mention a profile phrase (a trigger, a segment, a value) in their wording. */
export function phrasePromptIds(
  phrase: string,
  prompts: readonly BuyerPrompt[],
  options: { source?: BuyerPrompt['source'] } = {}
): string[] {
  return prompts
    .filter((prompt) => !options.source || prompt.source === options.source)
    .filter((prompt) => phraseMatches(promptText(prompt), phrase))
    .map((prompt) => prompt.id)
}

/** Prompts written from the title, meta description and H1. */
export function promiseSourceIds(prompts: readonly BuyerPrompt[]): string[] {
  return prompts.filter((prompt) => prompt.source === 'title_meta_h1').map((prompt) => prompt.id)
}
