/**
 * Fix → measure → repeat (the Fixes screen's loop). Pure rules shared by main and the
 * renderer, so a status, a bucket or a priority is decided in one place: main stores
 * nothing derived, and every count on screen comes from the same rows its drill lists.
 */

import type { PromptCheckRow } from './domain'

const DAY_MS = 86_400_000

/** A change live this many days or fewer is too new to judge. */
export const TOO_NEW_DAYS = 3

/** Lost ground: at least this many questions stopped citing the page… */
export const LOST_MIN_QUESTIONS = 3

/** …and they are at least this share of the questions that cited it before. */
export const LOST_MIN_SHARE = 0.3

/** Where a change stands on the ledger. */
export type ChangeStatus = 'cited' | 'not_cited' | 'too_new' | 'lost'

export const CHANGE_STATUSES: readonly { id: ChangeStatus; label: string }[] = [
  { id: 'cited', label: 'Cited now' },
  { id: 'not_cited', label: 'Not cited yet' },
  { id: 'too_new', label: 'Too new' },
  { id: 'lost', label: 'Lost ground' }
]

export function changeStatusLabel(status: ChangeStatus): string {
  return CHANGE_STATUSES.find((item) => item.id === status)?.label ?? 'Not cited yet'
}

/** The computer's calendar day of `ms`, as a day number (daylight saving cannot shift it). */
function localDayNumber(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS
}

/**
 * Whole days since `liveSince`, counted on the computer's calendar days (the go-live
 * date is the computer's midnight), so a change that went live yesterday is 1 day live
 * at any hour today, and one that went live today is 0 days live even late in the
 * evening. Negative for a change that goes live later. Null when the date does not parse.
 */
export function daysLive(liveSince: string, now: string | Date): number | null {
  const live = Date.parse(liveSince)
  const at = typeof now === 'string' ? Date.parse(now) : now.getTime()
  if (Number.isNaN(live) || Number.isNaN(at)) return null
  return localDayNumber(at) - localDayNumber(live)
}

/** The tracked page is cited for this question (the status Results shows). */
export function isCited(row: Pick<PromptCheckRow, 'status'>): boolean {
  return row.status === 'page_cited'
}

/**
 * Questions that cited the page in `before` and do not cite it in `now`. A question
 * missing from `now` (a newer prompt set) is not counted: it was not checked again.
 */
export function lostQuestions(
  before: readonly PromptCheckRow[],
  now: readonly PromptCheckRow[]
): PromptCheckRow[] {
  const current = new Map(now.map((row) => [row.promptId, row]))
  return before.filter((row) => {
    if (!isCited(row)) return false
    const later = current.get(row.promptId)
    return later !== undefined && !isCited(later)
  })
}

/**
 * The lost-ground rule: between two full checks the page lost at least
 * {@link LOST_MIN_QUESTIONS} cited questions and at least {@link LOST_MIN_SHARE}
 * of the questions that cited it before.
 */
export function isLostGround(input: { citedBefore: number; lost: number }): boolean {
  if (input.citedBefore <= 0 || input.lost < LOST_MIN_QUESTIONS) return false
  return input.lost / input.citedBefore >= LOST_MIN_SHARE
}

/**
 * A change's status. Lost ground wins (it needs a check before and one after);
 * then any cited question; then too new; else not cited yet.
 */
export function changeStatus(input: {
  daysLive: number | null
  citedBefore: number
  citedNow: number
  lost: number
  /** True when the latest full check started after the change went live. */
  measuredSinceLive: boolean
}): ChangeStatus {
  if (input.measuredSinceLive && isLostGround(input)) return 'lost'
  if (input.citedNow > 0) return 'cited'
  if (input.daysLive === null || input.daysLive <= TOO_NEW_DAYS) return 'too_new'
  return 'not_cited'
}

/** The "how fast changes get cited" buckets, by days live. */
export const DAY_BUCKETS = [
  { id: '0-3', label: '0–3 days', min: 0, max: 3 },
  { id: '4-7', label: '4–7 days', min: 4, max: 7 },
  { id: '8-13', label: '8–13 days', min: 8, max: 13 },
  { id: '14+', label: '14+ days', min: 14, max: null }
] as const

export type DayBucketId = (typeof DAY_BUCKETS)[number]['id']

export function isDayBucketId(value: string | null): value is DayBucketId {
  return DAY_BUCKETS.some((bucket) => bucket.id === value)
}

/** The bucket for a number of days live. Null before go-live. */
export function dayBucket(days: number | null): DayBucketId | null {
  if (days === null || days < 0) return null
  for (const bucket of DAY_BUCKETS) {
    if (days >= bucket.min && (bucket.max === null || days <= bucket.max)) return bucket.id
  }
  return null
}

/** The five steps of a round, in order. */
export const LOOP_STEPS = ['measure', 'reoptimise', 'publish', 'index', 'backlinks'] as const

export type LoopStep = (typeof LOOP_STEPS)[number]

export function isLoopStep(value: unknown): value is LoopStep {
  return typeof value === 'string' && LOOP_STEPS.some((step) => step === value)
}

/** Who does each step until the owner renames it. */
export const DEFAULT_LOOP_OWNERS: Readonly<Record<LoopStep, string>> = {
  measure: 'CiteFox',
  reoptimise: 'You',
  publish: 'Your team',
  index: 'Your team',
  backlinks: 'Your team'
}

/** Longest owner label, in characters. */
export const OWNER_LABEL_MAX = 40

/** Google index state of a page from its last "Check index". `unknown`: the check failed. */
export type IndexState = 'indexed' | 'not_indexed' | 'unknown'

/** Searches one page's index check may use: the Google search, and its overview follow-up. */
export const INDEX_SEARCHES_MIN = 1
export const INDEX_SEARCHES_MAX = 2

export type BacklinkPriority = 'first' | 'next'

/** What the backlink and next-round rules read from a ledger row. */
export interface LoopFacts {
  status: ChangeStatus
  daysLive: number | null
  /** Null: never checked. */
  index: IndexState | null
}

/** A page goes on the backlink ask list when it is not cited yet, lost ground, or not indexed. */
export function needsBacklinks(facts: LoopFacts): boolean {
  return facts.status === 'not_cited' || facts.status === 'lost' || facts.index === 'not_indexed'
}

/**
 * "First": lost ground, not cited a week after going live, or not indexed after the
 * first few days. Everything else on the list is "Next".
 */
export function backlinkPriority(facts: LoopFacts): BacklinkPriority {
  const days = facts.daysLive ?? 0
  if (facts.status === 'lost') return 'first'
  if (facts.status === 'not_cited' && days >= 7) return 'first'
  if (facts.index === 'not_indexed' && days > TOO_NEW_DAYS) return 'first'
  return 'next'
}

/** A page goes into the next round of re-optimisation when it is not cited yet or lost ground. */
export function inNextRound(facts: LoopFacts): boolean {
  return facts.status === 'not_cited' || facts.status === 'lost'
}
