import {
  fixVerdict,
  type FixMeasure,
  type FixQuestion,
  type FixVerdictView
} from '@shared/fix-verdict'
import { GOOGLE_UPDATES, type GoogleUpdate } from '@shared/google-updates'
import { formatDay } from '../utils/dates'

/**
 * Did it work? as the renderer says it: the verdict from `fixVerdict` (the one rule
 * main also reads), and the lines whose dates need the computer's own calendar.
 * Pure.
 */

/** The verdict of a measured fix on `now` (the ledger's `builtAt`). */
export function verdictOf(
  measure: Pick<FixMeasure, 'questions' | 'control'>,
  liveSince: string,
  now: string | Date
): FixVerdictView {
  return fixVerdict(measure, { liveSince, now, updates: GOOGLE_UPDATES })
}

/** "2/7 → 5/7": the fix's searches citing the page before go-live, and now. "—" with none. */
export function beforeNowShort(
  view: Pick<FixVerdictView, 'measured' | 'citedBefore' | 'citedNow'>
): string {
  if (view.measured === 0) return '—'
  return `${view.citedBefore}/${view.measured} → ${view.citedNow}/${view.measured}`
}

/** "1 of 8 → 5 of 8", for the chart marker's card. Null before any check since go-live. */
export function beforeNowLong(
  view: Pick<FixVerdictView, 'measured' | 'citedBefore' | 'citedNow'>
): string | null {
  if (view.measured === 0) return null
  return `${view.citedBefore} of ${view.measured} → ${view.citedNow} of ${view.measured}`
}

/** "Oct 8 – Oct 22" or "since Oct 2" for a rollout (its days, read at midday UTC). */
export function rolloutDays(update: Pick<GoogleUpdate, 'startedOn' | 'finishedOn'>): string {
  const from = formatDay(`${update.startedOn}T12:00:00Z`, { year: false })
  if (!update.finishedOn) return `since ${from}`
  return `${from} – ${formatDay(`${update.finishedOn}T12:00:00Z`, { year: false })}`
}

/**
 * "October 2026 core update rolled out Oct 8 – 22, during this window, so this
 * verdict is less certain." Null when no update overlapped.
 */
export function updateLine(view: Pick<FixVerdictView, 'updates' | 'state'>): string | null {
  const first = view.updates[0]
  if (!first) return null
  const more = view.updates.length - 1
  const rolled = first.finishedOn ? 'rolled out' : 'has been rolling out'
  const others = more > 0 ? ` (and ${more} more ${more === 1 ? 'update' : 'updates'})` : ''
  const verdict =
    view.state === 'worked' || view.state === 'worse' || view.state === 'no_change'
      ? ', so this verdict is less certain'
      : ''
  return `${first.name} ${rolled} ${rolloutDays(first)}${others}, during this window${verdict}.`
}

/** The fix's searches that won (not cited before, cited now) or lost. */
export function questionsIn(
  measure: Pick<FixMeasure, 'questions'>,
  ids: readonly string[]
): FixQuestion[] {
  const wanted = new Set(ids)
  return measure.questions.filter((question) => wanted.has(question.promptId))
}

/** Searches citing the page in the before check, or now (only those checked since go-live). */
export function citedQuestions(
  measure: Pick<FixMeasure, 'questions'>,
  which: 'before' | 'now'
): FixQuestion[] {
  return measure.questions.filter(
    (question) => question.now !== null && question[which]?.cited === true
  )
}

/** The searches checked since go-live: the "of 8". */
export function measuredQuestions(measure: Pick<FixMeasure, 'questions'>): FixQuestion[] {
  return measure.questions.filter((question) => question.now !== null)
}

/** The trend's values for a sparkline, and its top (the most searches checked). */
export function trendValues(measure: Pick<FixMeasure, 'trend'>): { values: number[]; max: number } {
  const values = measure.trend.map((point) => point.cited)
  const max = Math.max(1, ...measure.trend.map((point) => point.checked))
  return { values, max }
}
