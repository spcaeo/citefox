import { createContext, useContext } from 'react'
import { ENGINE_LABEL, type EngineId } from '@shared/domain'

/**
 * The words for a search that got no answer, on the picked engine. Google AI Overview
 * (and All, which shows Google's results) says "No AI Overview"; an answer engine
 * (ChatGPT, Perplexity, Gemini, Copilot, AI Mode) says "No answer", because those
 * engines answer with text, not an AI Overview.
 */
export interface ResultWords {
  /** The answer engine's name ("ChatGPT"); null for Google AI Overview and All. */
  engine: string | null
  /** A label or heading: "No AI Overview" / "No answer". */
  none: string
  /** After a count, in a legend: "no AI Overview" / "no answer". */
  noneLegend: string
  /** Before the first answer: "No AI Overview yet" / "No answer yet". */
  noneYet: string
  /** A count's header: "AI Overview" / "Answered". */
  answered: string
  /** After "searches": "with an AI Overview" / "ChatGPT answered". */
  withAnswer: string
  /** "What to do" on no answer: "Nothing to do: Google answered without one." */
  noneTodo: string
  /**
   * A cited own page when the screen has no target page yet ("Your page cited"): any
   * page of the site counts. Absent: "Target page" words.
   */
  cited?: { label: string; legend: string; heading: string }
}

/** The cited words for a screen with no target page yet. */
export const WHOLE_SITE_CITED = {
  label: 'Your page cited',
  legend: 'your page cited',
  heading: 'Your page is cited'
} as const

export const GOOGLE_WORDS: ResultWords = {
  engine: null,
  none: 'No AI Overview',
  noneLegend: 'no AI Overview',
  noneYet: 'No AI Overview yet',
  answered: 'AI Overview',
  withAnswer: 'with an AI Overview',
  noneTodo: 'Nothing to do: Google answered without one.'
}

/** The words for the picked engine (`all`, an engine id, or nothing). */
export function resultWords(engine: EngineId | 'all' | null | undefined): ResultWords {
  if (!engine || engine === 'all' || engine === 'google_aio') return GOOGLE_WORDS
  const name = ENGINE_LABEL[engine]
  return {
    engine: name,
    none: 'No answer',
    noneLegend: 'no answer',
    noneYet: 'No answer yet',
    answered: 'Answered',
    withAnswer: `${name} answered`,
    noneTodo: `Nothing to do: ${name} gave no answer.`
  }
}

/** The screen's result words; Google's outside a `ResultWordsProvider`. */
export const ResultWordsContext = createContext<ResultWords>(GOOGLE_WORDS)

/** The result words of the screen's picked engine; Google's outside a provider. */
export function useResultWords(): ResultWords {
  return useContext(ResultWordsContext)
}
