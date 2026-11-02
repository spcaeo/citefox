/** The coverage matrix (gaps) and FAQ drafts. */

import { isOneOf } from './one-of'

/** FR-4.1. */
const COVERAGE_LEVELS = ['strong', 'partial', 'weak', 'none'] as const

export type CoverageLevel = (typeof COVERAGE_LEVELS)[number]

/**
 * One action on a coverage row.
 * A row holds one or more of these. The TextBolt matrix uses both
 * `update_existing` and `new_faq` on the same prompt.
 */
const COVERAGE_ACTIONS = [
  'update_existing',
  'new_faq',
  'small_update',
  'optional_faq',
  'none'
] as const

export type CoverageAction = (typeof COVERAGE_ACTIONS)[number]

/** FR-4.1 and FR-4.5. The mock-up's priority on a coverage row. */
const COVERAGE_PRIORITIES = ['high', 'medium', 'low'] as const

export type CoveragePriority = (typeof COVERAGE_PRIORITIES)[number]

/**
 * Page-wide finding kinds. The five from the TextBolt reference, plus `other`.
 * The list is closed. Title length and title/meta mismatch are separate.
 */
const COVERAGE_FINDING_KINDS = [
  'factual_claim',
  'missing_promised_section',
  'typo',
  'title_length',
  'title_meta_mismatch',
  'other'
] as const

export type CoverageFindingKind = (typeof COVERAGE_FINDING_KINDS)[number]

/** FR-4.2. A recommended FAQ draft is this long. */
export const FAQ_DRAFT_MIN_WORDS = 40

export const FAQ_DRAFT_MAX_WORDS = 70

/** Draft FAQ on a coverage row (FR-4.2). */
export interface SuggestedFaq {
  question: string
  answer: string
  /** Words in `answer`. The recommended range is {@link FAQ_DRAFT_MIN_WORDS} to {@link FAQ_DRAFT_MAX_WORDS}. */
  wordCount: number
}

/**
 * One page × prompt coverage row, stored on a run.
 * `actions` has at least one entry. A row can carry both `update_existing` and `new_faq`.
 * `done` is the FR-4.6 mark and stays on the row.
 */
export interface CoverageRecord {
  id: string
  runId: string
  pageId: string
  promptId: string
  coverage: CoverageLevel
  whereCovered: readonly string[]
  /** What the page says today for this prompt (FR-4.5). */
  currentContent: string
  /** What to change (FR-4.5). */
  whatToUpdate: string
  mainGap: string
  priority: CoveragePriority
  actions: readonly [CoverageAction, ...CoverageAction[]]
  suggestedFaq: SuggestedFaq | null
  done: boolean
}

/** A page-wide finding stored with the same run as the rows. */
export interface CoverageFinding {
  id: string
  runId: string
  pageId: string
  kind: CoverageFindingKind
  summary: string
  detail: string
}

/**
 * A coverage matrix stored for one run, so a later check can compare it.
 * `reused` means this generate did not call Claude again (FR-4.7).
 */
export interface CoverageMatrix {
  runId: string
  pageId: string
  /** ISO-8601 UTC. */
  recordedAt: string
  /**
   * Template that produced the rows.
   * The id stays after that template is soft-deleted, so this matrix stays readable.
   */
  templateId: string
  /** That template's name at generation. A later rename does not change this. */
  templateName: string
  /** Lowercase SHA-256 hex of the template body that was used. */
  templateHash: string
  /**
   * That template's `updatedAt` at generation.
   * Null when the template had not been changed since it was created.
   */
  templateUpdatedAt: string | null
  /** SHA-256 of the normalized page body this matrix was written from (FR-2.3, FR-4.7). */
  contentHash: string
  reused: boolean
  /** True when the page fingerprint has changed since `contentHash`. */
  stale: boolean
  rows: readonly CoverageRecord[]
  findings: readonly CoverageFinding[]
}

/** One stored matrix, without the rows. `coverage:list` returns these. */
export interface CoverageRunRef {
  runId: string
  pageId: string
  recordedAt: string
  contentHash: string
}

export function isCoverageLevel(value: string): value is CoverageLevel {
  return isOneOf(COVERAGE_LEVELS, value)
}

export function isCoverageAction(value: string): value is CoverageAction {
  return isOneOf(COVERAGE_ACTIONS, value)
}

export function isCoveragePriority(value: string): value is CoveragePriority {
  return isOneOf(COVERAGE_PRIORITIES, value)
}

export function isCoverageFindingKind(value: string): value is CoverageFindingKind {
  return isOneOf(COVERAGE_FINDING_KINDS, value)
}
