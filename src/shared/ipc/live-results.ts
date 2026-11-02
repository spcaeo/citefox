/**
 * Results while a check runs. Each question's result is stored as soon as it is
 * scored, so the topic page, Summary and Questions read it straight away instead
 * of waiting for the whole check. A check that stops part-way keeps what it saved.
 */

import type { EngineId } from '../domain'
import { push, type PushChannelSpecs } from './contract'

/** Questions and keywords of one check, done so far and in all. */
export interface LiveCount {
  done: number
  total: number
}

/**
 * A check whose results are on screen before it finished.
 * `running`: answers are still coming in. `stopped`: it ended part-way (stopped,
 * out of credits or failed); the answers it saved stay, marked as from a partial check.
 */
export interface LiveCheck {
  state: 'running' | 'stopped'
  jobId: string
  /** Questions and keywords together. */
  done: number
  total: number
  questions: LiveCount
  keywords: LiveCount
  /** ISO-8601 UTC. */
  startedAt: string
  /** When a stopped check ended. Null while it runs. */
  endedAt: string | null
}

/**
 * A question of a running check with no result yet: `checking` is being searched
 * now, `waiting` has its turn later. Never "not cited" and never 0.
 */
export type LiveRowState = 'waiting' | 'checking'

/**
 * Pushed when a running check saves one question's result, and once when the job
 * ends (`state` is then `finished` or `stopped`). Screens re-read only the views
 * the event names, debounced.
 */
export interface ResultsChanged {
  projectId: string
  jobId: string
  pageId: string
  marketId: string | null
  /** The question just saved. Null on the job's end event. */
  promptId: string | null
  state: 'running' | 'finished' | 'stopped'
  /** The job's questions done so far and in all (every page and market). */
  done: number
  total: number
  /** The saved question's own-site result, for the celebration. Absent on end events. */
  citation?: CitationNews | null
}

/**
 * One saved question where the user's own site is cited (a link in the AI Overview
 * or an answer engine), or only named in the text. Never sent for competitors.
 */
export interface CitationNews {
  kind: 'cited' | 'named'
  /** The brand as the user named it, else the domain. */
  brand: string
  promptText: string
  /** The best link number (1 is the first link). Null when only named. */
  position: number | null
  /** The engine with that best link (Google AI Overview first on a tie). Null when only named. */
  engine: EngineId | null
  /** The address of that link, for the celebration card. Null when only named. */
  url: string | null
  /** No check of this project before this one cited its site. */
  firstEver: boolean
}

/** Push events for this area. */
export const liveResultsEvents = {
  'results:changed': push<ResultsChanged>()
} as const satisfies PushChannelSpecs
