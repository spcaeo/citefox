import { normaliseQuestion } from '@shared/question-text'
import { isRecord } from '../json-schema'

/** One of Google's organic results, as stored: its place, address and host. */
export interface OrganicResult {
  /** 1-based place among the organic results. */
  position: number
  url: string
  /** Lowercase host without `www.`. */
  domain: string
}

/**
 * What a stored Google search holds besides the AI Overview. `organic` is null when
 * the body had no organic list (an error, an old or cut-off body), so "not in the
 * top 10" is only said when Google's results were there to read.
 */
export interface GoogleExtras {
  organic: readonly OrganicResult[] | null
  /** "People also ask", in Google's order, repeats left out. */
  questions: readonly string[]
}

/** Google's first page: places past this are not kept. */
export const ORGANIC_TOP = 10
/** More "People also ask" than Google ever shows on one search. */
const MAX_QUESTIONS = 12
const MAX_URL = 2000
const MAX_QUESTION = 300

export const NO_EXTRAS: GoogleExtras = { organic: null, questions: [] }

/** Reads the extras from a stored search body. Null, cut-off or odd JSON gives {@link NO_EXTRAS}. */
export function googleExtrasFromRaw(raw: string | null): GoogleExtras {
  if (raw === null || raw.length === 0) return NO_EXTRAS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return NO_EXTRAS
  }
  return readGoogleExtras(parsed)
}

/** SerpApi's `organic_results` (top 10) and `related_questions` from a parsed body. */
export function readGoogleExtras(body: unknown): GoogleExtras {
  if (!isRecord(body)) return NO_EXTRAS
  return { organic: readOrganic(body.organic_results), questions: readQuestions(body) }
}

function readOrganic(value: unknown): OrganicResult[] | null {
  if (!Array.isArray(value)) return null
  const found: OrganicResult[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || typeof item.link !== 'string') continue
    const position =
      typeof item.position === 'number' && Number.isInteger(item.position) && item.position >= 1
        ? item.position
        : index + 1
    if (position > ORGANIC_TOP) continue
    const url = item.link.trim()
    const domain = hostOf(url)
    if (url.length === 0 || url.length > MAX_URL || domain === null) continue
    found.push({ position, url, domain })
  }
  return found.sort((left, right) => left.position - right.position)
}

function readQuestions(body: Record<string, unknown>): string[] {
  const list = body.related_questions
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const found: string[] = []
  for (const item of list) {
    if (found.length >= MAX_QUESTIONS) break
    if (!isRecord(item) || typeof item.question !== 'string') continue
    const text = item.question.replace(/\s+/gu, ' ').trim()
    const key = normaliseQuestion(text)
    if (key.length === 0 || text.length > MAX_QUESTION || seen.has(key)) continue
    seen.add(key)
    found.push(text)
  }
  return found
}

function hostOf(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}
