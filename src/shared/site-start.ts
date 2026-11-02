/**
 * Pure rules for the first-run plan (owner feedback 4), shared so the plan
 * screen shows the same numbers main uses.
 */

import { SEARCHES_PER_PROMPT_MAX, SEARCHES_PER_PROMPT_MIN } from './domain'
import type { SiteStartBudget, SiteStartPlan, StartJourney } from './ipc'

/** Most pages the autopilot picks as likely to matter, and how many the plan ticks. */
export const START_MAX_PAGES = 12
export const START_MIN_PAGES = 3
export const START_RECOMMENDED_PAGES = 3
export const START_MAX_TOPICS = 2
/** Questions the autopilot drafts for the first topic. */
export const START_QUESTION_COUNT = 10

export interface StartPlanEstimate {
  questions: number
  /** One check of every question, in every market, at every sample. */
  minSearches: number
  maxSearches: number
  searchesLeft: number | null
  /** Null when the allowance is unknown; else whether the high end fits. */
  fits: boolean | null
  /** Searches left after the high end; null when unknown. */
  leftAfter: number | null
}

/** Searches for the first check of `questions` questions. Target pages add none. */
export function estimateFirstCheck(budget: SiteStartBudget, questions: number): StartPlanEstimate {
  const count = whole(questions)
  const units = count * Math.max(1, whole(budget.markets)) * Math.max(1, whole(budget.samples))
  const maxSearches = units * SEARCHES_PER_PROMPT_MAX
  const left = budget.searchesLeft
  return {
    questions: count,
    minSearches: units * SEARCHES_PER_PROMPT_MIN,
    maxSearches,
    searchesLeft: left,
    fits: left === null ? null : maxSearches <= left,
    leftAfter: left === null ? null : Math.max(0, left - units * SEARCHES_PER_PROMPT_MIN)
  }
}

/** The target pages ticked when the plan opens: the recommended ones not already tracked first. */
export function defaultTargetUrls(
  plan: Pick<SiteStartPlan, 'pages' | 'recommendedUrls'>
): string[] {
  const known = new Set(plan.pages.map((page) => page.url))
  const picked = plan.recommendedUrls.filter((url) => known.has(url))
  if (picked.length > 0) return picked.slice(0, START_RECOMMENDED_PAGES)
  return plan.pages.slice(0, START_RECOMMENDED_PAGES).map((page) => page.url)
}

/** "10–20 searches" (or "10 searches" when both ends match). */
export function searchRangeText(
  estimate: Pick<StartPlanEstimate, 'minSearches' | 'maxSearches'>
): string {
  const lo = estimate.minSearches.toLocaleString('en-US')
  const hi = estimate.maxSearches.toLocaleString('en-US')
  return lo === hi ? `${lo} searches` : `${lo}–${hi} searches`
}

/** The five journey steps of the focus-mode stepper. */
export const START_JOURNEY_STEPS = [
  { id: 'read', label: 'Read your site' },
  { id: 'found', label: 'What we found' },
  { id: 'plan', label: 'Plan' },
  { id: 'check', label: 'First check' },
  { id: 'results', label: 'Results' }
] as const

export type StartJourneyStep = (typeof START_JOURNEY_STEPS)[number]['id']

/** The furthest journey step reached, from `start:status`. */
export function journeyReached(journey: StartJourney | null): StartJourneyStep {
  if (journey === null || !journey.hasPlan) return 'read'
  if (journey.hasResults) return 'results'
  if (journey.checkStarted) return 'check'
  return 'found'
}

/** "1:04" for the elapsed clock. */
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** "about 8 s left", "about 1 min left". */
export function etaText(seconds: number | null): string | null {
  if (seconds === null) return null
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} s left`
  return `about ${Math.round(seconds / 60)} min left`
}

function whole(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
