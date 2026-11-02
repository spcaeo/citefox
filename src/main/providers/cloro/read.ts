import { isRecord } from '../json-schema'
import { NO_EXTRAS, readGoogleExtras, type GoogleExtras } from '../serpapi/extras'
import type { ParsedAiOverview } from '../serpapi/overview'
import { readCloroSources, textOf, type CloroSource } from './api'

/**
 * One cloro Google search, read into the shapes the SerpApi path fills, so citations,
 * competitors, rank, "People also ask" and reports read it the same way.
 * `overview` is null when Google showed no AI Overview: a normal "no AIO", not an error.
 */
export interface CloroGoogleRead {
  overview: ParsedAiOverview | null
  markdown: string | null
  extras: GoogleExtras
}

/** Reads `result` of a successful `/v1/monitor/google` body. */
export function readCloroGoogle(bodyText: string): CloroGoogleRead {
  const result = resultOf(bodyText)
  if (result === null) return { overview: null, markdown: null, extras: NO_EXTRAS }
  return {
    overview: readOverview(result.aioverview),
    markdown: isRecord(result.aioverview) ? textOf(result.aioverview.markdown) : null,
    extras: cloroGoogleExtras(result)
  }
}

/**
 * Organic top 10 and "People also ask", through the SerpApi reader so the limits and
 * clean-up are the same (cloro's `organicResults` and `peopleAlsoAsk`).
 */
export function cloroGoogleExtras(result: Record<string, unknown>): GoogleExtras {
  const organic = Array.isArray(result.organicResults)
    ? result.organicResults.flatMap((item) =>
        isRecord(item) && typeof item.link === 'string'
          ? [{ position: item.position, link: item.link }]
          : []
      )
    : undefined
  return readGoogleExtras({ organic_results: organic, related_questions: result.peopleAlsoAsk })
}

function readOverview(value: unknown): ParsedAiOverview | null {
  if (!isRecord(value)) return null
  const text = textOf(value.text)
  const references = readCloroSources(value.sources, value.citationPills).map((source) => ({
    url: source.url,
    title: source.title
  }))
  if (text === null && references.length === 0) return null
  return {
    text: text === null ? null : text.replace(/\s+/g, ' '),
    references,
    pageToken: null,
    error: null
  }
}

/**
 * One engine answer (ChatGPT, Perplexity, AI Mode, Gemini, Copilot). `empty` follows
 * cloro's guidance for a canned reply (a refusal, a notice): no sources and under 160
 * characters of text. It is stored as "no answer", text kept.
 */
export interface CloroAnswerRead {
  text: string | null
  markdown: string | null
  sources: CloroSource[]
  empty: boolean
}

/** Shorter than this, with no sources, is a canned reply rather than an answer. */
export const CLORO_EMPTY_ANSWER_CHARS = 160

export function readCloroAnswer(bodyText: string): CloroAnswerRead {
  const result = resultOf(bodyText)
  if (result === null) return { text: null, markdown: null, sources: [], empty: true }
  const text = textOf(result.text)
  const markdown = textOf(result.markdown)
  const sources = readCloroSources(result.sources, result.citationPills)
  const body = text ?? markdown ?? ''
  return {
    text,
    markdown,
    sources,
    empty: sources.length === 0 && body.length < CLORO_EMPTY_ANSWER_CHARS
  }
}

function resultOf(bodyText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(bodyText) as unknown
    return isRecord(parsed) && isRecord(parsed.result) ? parsed.result : null
  } catch {
    return null
  }
}
