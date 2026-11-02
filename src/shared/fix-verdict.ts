/**
 * "Did it work?": one plain verdict per logged fix. Pure, shared by main (the Changes
 * ledger, the fix list, the Activity note) and the renderer (the Verdict column, the
 * change drawer, the chart marker card), so every screen says the same thing.
 *
 * - Before: each of the fix's searches in the last check of its page or topic that
 *   finished before go-live. After: the latest check from go-live on. Only the fix's
 *   own searches count, from whichever checks hold them (topic checks included).
 * - Too early until the fix has been live {@link VERDICT_WAIT_DAYS} days. Then Worked
 *   (more searches cite the page than before), Worse (fewer) or No change.
 * - Untouched searches (the same pages' and topics' searches not in the fix, over the
 *   same window) say whether the move may be Google's rather than the fix's; so does
 *   a Google update that rolled out inside the window.
 */

import type { PromptCheckRow } from './domain'
import { daysLive } from './fix-loop'
import type { GoogleUpdate } from './google-updates'
import { sameTargetPage } from './target-page'

const DAY_MS = 86_400_000

/** Days a fix is live before CiteFox says Worked, No change or Worse. */
export const VERDICT_WAIT_DAYS = 14

/** Untouched searches needed before the comparison says anything. */
export const CONTROL_MIN_QUESTIONS = 3

/** A move smaller than this share of searches reads as no move at all. */
export const CONTROL_FLAT_SHARE = 0.05

/** One of a fix's searches in one stored check. */
export interface FixQuestionCheck {
  runId: string
  /** ISO-8601 UTC when the check finished. */
  checkedAt: string
  /** The fix's page is cited for this search. */
  cited: boolean
  /** The page's place in the answer's sources. Null when not cited. */
  position: number | null
}

/** One search a fix should win, where it stood before go-live and where it stands now. */
export interface FixQuestion {
  promptId: string
  /** The page or topic the search belongs to (the checks that ask it). */
  sourceId: string
  sourceKind: 'page' | 'topic'
  sourceName: string
  /** The market it is measured in. */
  marketId: string
  /** "Q6". */
  label: string
  text: string
  /** Last check before go-live. Null when it was never checked before. */
  before: FixQuestionCheck | null
  /** Latest check from go-live on. Null until one runs. */
  now: FixQuestionCheck | null
}

/** The same pages' and topics' searches the fix did not target, over the same window. */
export interface FixControl {
  /** Untouched searches checked both before go-live and since. */
  questions: number
  /** Of those, the ones citing a page of your site before go-live, and now. */
  citedBefore: number
  citedNow: number
}

/** The fix's searches citing the page after each check, oldest first. */
export interface FixTrendPoint {
  /** ISO-8601 UTC. */
  at: string
  cited: number
  /** Searches with a result by then. */
  checked: number
}

/** What main measured for a fix. The verdict is read from it with {@link fixVerdict}. */
export interface FixMeasure {
  /** The page the fix is about. Null: any page of your site counts as cited. */
  url: string | null
  questions: readonly FixQuestion[]
  control: FixControl | null
  trend: readonly FixTrendPoint[]
}

export type FixVerdictState = 'planned' | 'too_early' | 'waiting' | 'worked' | 'no_change' | 'worse'

export type FixVerdictTone = 'good' | 'wait' | 'bad'

/** How untouched searches moved next to the fix. */
export type ControlMove = 'same' | 'other' | 'flat' | 'too_few'

export interface FixVerdictView {
  state: FixVerdictState
  tone: FixVerdictTone
  /** Whole days live. Null when the go-live date does not parse. */
  daysLive: number | null
  /** Days until the verdict (too early), else 0. */
  daysLeft: number
  /** Searches with a check since go-live (the "of 8"). */
  measured: number
  /** Of those, citing the page before go-live and now. */
  citedBefore: number
  citedNow: number
  /** Prompt ids: not cited before, cited now; and the other way round. */
  won: readonly string[]
  lost: readonly string[]
  /** Null while too early or with no check since go-live. */
  control: ControlMove | null
  /** Google updates that rolled out between the before check and now. */
  updates: readonly GoogleUpdate[]
  /** A Google update overlapped, or untouched searches moved the same way. */
  lessCertain: boolean
  /** The window the verdict compares: the earliest before check (else go-live) to now. */
  window: { from: string; to: string }
}

/** The answer's own sources name `url` (any page of your site when `url` is null). */
export function citesPage(
  row: Pick<PromptCheckRow, 'status' | 'citedUrl' | 'references'>,
  url: string | null
): boolean {
  if (url === null) return row.status === 'page_cited' || row.status === 'other_own_page'
  if (sameTargetPage(row.citedUrl, url)) return true
  return row.references.some((reference) => sameTargetPage(reference.url, url))
}

/** A page of your site is cited (the untouched searches' measure). */
export function citesOwnSite(row: Pick<PromptCheckRow, 'status'>): boolean {
  return row.status === 'page_cited' || row.status === 'other_own_page'
}

/** Days left before a verdict. 0 once the wait is over. */
export function verdictDaysLeft(days: number | null): number {
  if (days === null) return VERDICT_WAIT_DAYS
  return Math.max(0, VERDICT_WAIT_DAYS - days)
}

/** Updates whose rollout touches `[from, to]` (a rollout still running reaches `to`). */
export function updatesInWindow(
  updates: readonly GoogleUpdate[],
  from: string,
  to: string
): GoogleUpdate[] {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end)) return []
  return updates.filter((update) => {
    const began = Date.parse(`${update.startedOn}T00:00:00Z`)
    const ended = update.finishedOn
      ? Date.parse(`${update.finishedOn}T00:00:00Z`) + DAY_MS
      : Number.POSITIVE_INFINITY
    return began <= end && ended >= start
  })
}

/**
 * How untouched searches moved next to the fix's own move (both as a share of their
 * searches). Same: the same direction and at least half the size. Other: the opposite
 * direction. Flat: no real move. Too few: under {@link CONTROL_MIN_QUESTIONS} searches.
 */
export function controlMove(control: FixControl | null, fixShift: number): ControlMove {
  if (control === null || control.questions < CONTROL_MIN_QUESTIONS) return 'too_few'
  const shift = (control.citedNow - control.citedBefore) / control.questions
  if (Math.abs(shift) < CONTROL_FLAT_SHARE) return 'flat'
  if (fixShift === 0) return 'other'
  if (Math.sign(shift) !== Math.sign(fixShift)) return 'other'
  return Math.abs(shift) >= Math.abs(fixShift) / 2 ? 'same' : 'flat'
}

/** The verdict for one measured fix on `now`. */
export function fixVerdict(
  measure: Pick<FixMeasure, 'questions' | 'control'>,
  options: { liveSince: string; now: string | Date; updates: readonly GoogleUpdate[] }
): FixVerdictView {
  const nowIso = typeof options.now === 'string' ? options.now : options.now.toISOString()
  const days = daysLive(options.liveSince, nowIso)
  const measured = measure.questions.filter((question) => question.now !== null)
  const won = measured
    .filter((question) => question.now?.cited === true && question.before?.cited !== true)
    .map((question) => question.promptId)
  const lost = measured
    .filter((question) => question.now?.cited !== true && question.before?.cited === true)
    .map((question) => question.promptId)
  const citedBefore = measured.filter((question) => question.before?.cited === true).length
  const citedNow = measured.filter((question) => question.now?.cited === true).length
  const window = verdictWindow(measure.questions, options.liveSince, nowIso)
  const updates = updatesInWindow(options.updates, window.from, window.to)
  const base = {
    daysLive: days,
    daysLeft: verdictDaysLeft(days),
    measured: measured.length,
    citedBefore,
    citedNow,
    won,
    lost,
    updates,
    window
  }
  if (days === null || days < 0) {
    return { ...base, state: 'planned', tone: 'wait', control: null, lessCertain: false }
  }
  if (days < VERDICT_WAIT_DAYS) {
    return { ...base, state: 'too_early', tone: 'wait', control: null, lessCertain: false }
  }
  if (measured.length === 0) {
    return { ...base, state: 'waiting', tone: 'wait', control: null, lessCertain: false }
  }
  const shift = (won.length - lost.length) / measured.length
  const state: FixVerdictState =
    won.length > lost.length ? 'worked' : lost.length > won.length ? 'worse' : 'no_change'
  const control = controlMove(measure.control, shift)
  return {
    ...base,
    state,
    tone: state === 'worked' ? 'good' : state === 'worse' ? 'bad' : 'wait',
    control,
    lessCertain: updates.length > 0 || (state !== 'no_change' && control === 'same')
  }
}

/** From the earliest "before" check (else go-live) to the latest check since (else now). */
function verdictWindow(
  questions: readonly FixQuestion[],
  liveSince: string,
  now: string
): { from: string; to: string } {
  const befores = questions.flatMap((question) =>
    question.before ? [question.before.checkedAt] : []
  )
  const nows = questions.flatMap((question) => (question.now ? [question.now.checkedAt] : []))
  const from = befores.length > 0 ? befores.reduce((a, b) => (a < b ? a : b)) : liveSince
  const to = nows.length > 0 ? nows.reduce((a, b) => (a > b ? a : b)) : now
  return { from, to: to < from ? from : to }
}

/** "Worked", "Too early · 12 days left", "No change", "Worse", "Waiting for a check". */
export function verdictLabel(
  view: Pick<FixVerdictView, 'state' | 'daysLeft' | 'daysLive'>
): string {
  switch (view.state) {
    case 'worked':
      return 'Worked'
    case 'worse':
      return 'Worse'
    case 'no_change':
      return 'No change'
    case 'waiting':
      return 'Waiting for a check'
    case 'planned': {
      const ahead = view.daysLive === null ? null : -view.daysLive
      return ahead === null
        ? 'Goes live later'
        : `Goes live in ${ahead} ${ahead === 1 ? 'day' : 'days'}`
    }
    default:
      return `Too early · ${view.daysLeft} ${view.daysLeft === 1 ? 'day' : 'days'} left`
  }
}

function searches(count: number): string {
  return `${count} ${count === 1 ? 'search' : 'searches'}`
}

/** "Won 4 searches, lost none. Live 57 days." */
export function verdictSummary(
  view: Pick<FixVerdictView, 'won' | 'lost' | 'daysLive' | 'measured'>
): string {
  const live =
    view.daysLive === null || view.daysLive < 0
      ? ''
      : ` Live ${view.daysLive} ${view.daysLive === 1 ? 'day' : 'days'}.`
  if (view.measured === 0) return `No check since it went live yet.${live}`
  const won = view.won.length === 0 ? 'Won none' : `Won ${searches(view.won.length)}`
  const lost = view.lost.length === 0 ? 'lost none' : `lost ${searches(view.lost.length)}`
  return `${won}, ${lost}.${live}`
}

/** The untouched-searches line, or null when there is nothing to say yet. */
export function controlLine(view: Pick<FixVerdictView, 'state' | 'control'>): string | null {
  if (view.control === null) return null
  if (view.control === 'too_few') return 'Too few similar searches you did not touch to compare.'
  if (view.state === 'no_change') {
    return view.control === 'flat'
      ? 'Similar searches you did not touch did not move either.'
      : 'Similar searches you did not touch moved in the same time.'
  }
  if (view.control === 'same') {
    return 'Similar searches you did not touch moved the same way, so this may not be your fix.'
  }
  if (view.control === 'other') {
    return 'Similar searches you did not touch went the other way, so this looks like your fix.'
  }
  return 'Similar searches you did not touch: no change, so this looks like your fix.'
}

/** "Fix 2 on /blog/x is working: 4 more searches cite it". */
export function workingNote(
  number: number,
  path: string,
  view: Pick<FixVerdictView, 'citedBefore' | 'citedNow'>
): string {
  const more = view.citedNow - view.citedBefore
  return `Fix ${number} on ${path} is working: ${more} more ${more === 1 ? 'search cites' : 'searches cite'} it`
}

/** One check of a page or topic: the fix's searches it holds, cited or not. */
export interface TrendSnapshot {
  at: string
  states: readonly (readonly [promptId: string, cited: boolean])[]
}

/**
 * The fix's searches citing the page after each check: each check updates the
 * searches it holds, the rest keep their last result. Checks on the same moment
 * merge. At most `limit` points, the newest kept.
 */
export function citedTrend(snapshots: readonly TrendSnapshot[], limit = 12): FixTrendPoint[] {
  const sorted = [...snapshots].sort((a, b) => a.at.localeCompare(b.at))
  const latest = new Map<string, boolean>()
  const points: FixTrendPoint[] = []
  for (const snapshot of sorted) {
    for (const [promptId, cited] of snapshot.states) latest.set(promptId, cited)
    const point = {
      at: snapshot.at,
      cited: [...latest.values()].filter(Boolean).length,
      checked: latest.size
    }
    const last = points.at(-1)
    if (last && last.at === point.at) points[points.length - 1] = point
    else points.push(point)
  }
  return points.slice(-limit)
}
