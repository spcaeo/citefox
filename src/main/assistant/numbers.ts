/**
 * The number check (deep audit crosscut §3.5 rule 2): an Ask CiteFox answer
 * may only quote numbers that are in what it was given (the packet counted in
 * code, the screen's numbers, the question and the turns before). A number
 * that is not there was invented: the sentence holding it is taken out and
 * the number is reported, so the drawer can say so.
 */

/** Digits, with thousands commas and decimals; refs such as R3 or N12 are not numbers. */
const NUMBER =
  /(?<![A-Za-z\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d])|(?<![A-Za-z\d.,])\d+(?:\.\d+)?(?![\d])/g

/** A number as compared: commas out, a trailing `.0` dropped, leading zeros dropped. */
export function normalizeNumber(token: string): string {
  const plain = token.replace(/,/g, '')
  const [whole = '0', fraction] = plain.split('.')
  const int = whole.replace(/^0+(?=\d)/, '')
  const frac = fraction?.replace(/0+$/, '') ?? ''
  return frac.length > 0 ? `${int}.${frac}` : int
}

export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((match) => normalizeNumber(match[0]))
}

/** Every number in the given texts. */
export function allowedNumbers(...texts: readonly string[]): Set<string> {
  const allowed = new Set<string>()
  for (const text of texts) for (const value of numbersIn(text)) allowed.add(value)
  return allowed
}

/** Numbers in `text` that are not allowed, each once, in order. */
export function unknownNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const value of numbersIn(withoutListMarkers(text))) {
    if (!allowed.has(value) && !out.includes(value)) out.push(value)
  }
  return out
}

export interface NumberCheck {
  text: string
  /** The numbers taken out, each once. */
  flagged: string[]
}

/**
 * `text` without the sentences that quote a number not in `allowed`. A text
 * left with nothing says so in one sentence instead of guessing.
 */
export function stripUnknownNumbers(text: string, allowed: ReadonlySet<string>): NumberCheck {
  const flagged: string[] = []
  const kept: string[] = []
  for (const sentence of sentences(text)) {
    const bad = unknownNumbers(sentence, allowed)
    if (bad.length === 0) {
      kept.push(sentence)
      continue
    }
    for (const value of bad) if (!flagged.includes(value)) flagged.push(value)
  }
  const joined = kept.join(' ').trim()
  return {
    text:
      joined.length > 0
        ? joined
        : 'CiteFox could not answer this from your saved checks without guessing a number.',
    flagged
  }
}

/** Words whose dot does not end a sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|vs|etc|approx|no|mr|ms|dr)\.$/i

/**
 * Sentences, keeping their end marks. Line breaks also end a sentence. A
 * sentence may start in lower case (a domain such as "simpletexting.com").
 */
export function sentences(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^\s*(?:\d{1,2}[.)]|[-*•])\s+/, '')
    const parts: string[] = []
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const piece = part.trim()
      if (piece.length === 0) continue
      const last = parts[parts.length - 1]
      if (last !== undefined && ABBREVIATION.test(last))
        parts[parts.length - 1] = `${last} ${piece}`
      else parts.push(piece)
    }
    out.push(...parts)
  }
  return out
}

/** "1. ", "2) " at the start of a line are list numbers, not data. */
function withoutListMarkers(text: string): string {
  return text.replace(/^\s*\d{1,2}[.)]\s+/gm, '')
}
