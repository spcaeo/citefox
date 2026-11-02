/** History and notes (SRS section 4.15, FR-7.3, FR-7.4). */

import type { CheckRunKind } from './checks'
import { isOneOf } from './one-of'

/** FR-15.1 filter kinds. */
const HISTORY_EVENT_KINDS = ['check', 'content', 'prompt_set', 'fix', 'note'] as const

export type HistoryEventKind = (typeof HISTORY_EVENT_KINDS)[number]

/** A check entry (FR-15.2): its score and the change since the previous full check. */
export interface HistoryCheck {
  runId: string
  marketId: string
  kind: CheckRunKind
  /** A follow-up that checked only some prompts (FR-14.6). It has no change. */
  partial: boolean
  promptsChecked: number
  promptsTotal: number
  /** Visibility score 0–100, the number Results shows for that check. */
  score: number | null
  /** Score minus the previous full check in the same prompt-set version. Null for the first or a partial check. */
  scoreChange: number | null
  promptSetVersion: number | null
  /**
   * Whether the page content changed since the previous check in this market
   * (FR-7.3). Null for the first check. When true, the event's `content` says what.
   */
  contentChanged: boolean | null
}

/** A page content change (FR-7.3, FR-15.2). */
export interface HistoryContentChange {
  /** "2 FAQs added, 410 words added." */
  summary: string
  /** Null for the first read of the page. */
  fromSnapshotId: string | null
  toSnapshotId: string
  /** Page last-modified date the page itself states, when it has one (ISO-8601). */
  modifiedAt: string | null
}

export interface HistoryNote {
  id: string
  /** Local calendar date, YYYY-MM-DD, as the user picked it. */
  date: string
  /** Untrusted text: render with the Markdown component. */
  text: string
}

export interface HistoryFix {
  id: string
  number: number
  /** Stored FR-14.7 verdict text, or null while waiting. */
  verdict: string | null
  /** True when go-live is after the time History was built. */
  planned: boolean
  promptPositions: readonly number[]
}

export interface HistoryPromptSet {
  id: string
  version: number
  promptCount: number
  active: boolean
}

/**
 * One History row. `kinds` is every filter it is listed under: a check whose
 * page content changed is both `check` and `content`. Exactly one of the detail
 * fields matches `primary`; `content` may also be set on a check.
 */
export interface HistoryEvent {
  id: string
  primary: HistoryEventKind
  kinds: readonly HistoryEventKind[]
  /** ISO-8601 UTC instant used for ordering. Notes use noon local time on their date. */
  at: string
  /** Short title such as "Scheduled check" or "Fix 2 · Added 5 FAQs". Untrusted where it quotes user text. */
  title: string
  /** One line under the title. Null when there is nothing to add. */
  detail: string | null
  check: HistoryCheck | null
  content: HistoryContentChange | null
  note: HistoryNote | null
  fix: HistoryFix | null
  promptSet: HistoryPromptSet | null
}

/** `history:list`. Newest first. */
export interface PageHistory {
  pageId: string
  /** Checks are this market's. Other kinds are page-wide. */
  marketId: string
  builtAt: string
  events: readonly HistoryEvent[]
}

/** A stored note (section 10 `notes`). */
export interface PageNote {
  id: string
  pageId: string
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  text: string
  createdAt: string
  updatedAt: string
}

/** One line of a readable diff. */
export interface DiffLine {
  op: 'same' | 'added' | 'removed'
  text: string
}

export interface ContentFieldChange {
  field: 'title' | 'meta_description' | 'h1'
  label: string
  before: string | null
  after: string | null
  changed: boolean
}

export interface SnapshotStamp {
  id: string
  fetchedAt: string
  wordCount: number
  faqCount: number
}

/** `history:compare`. A readable diff of two page reads (FR-15.1 "Compare content"). */
export interface ContentDiff {
  pageId: string
  from: SnapshotStamp
  to: SnapshotStamp
  summary: string
  fields: readonly ContentFieldChange[]
  /** Headings, indented by level with two spaces per level below H2. */
  outline: readonly DiffLine[]
  /** "Q: …" lines, each followed by its "A: …" line. */
  faqs: readonly DiffLine[]
  /** Body text by sentence-sized lines. */
  body: readonly DiffLine[]
  /** True when the body was too long to diff line by line and was cut. */
  bodyTruncated: boolean
}

export function isHistoryEventKind(value: string): value is HistoryEventKind {
  return isOneOf(HISTORY_EVENT_KINDS, value)
}

export const HISTORY_KINDS: readonly HistoryEventKind[] = HISTORY_EVENT_KINDS
