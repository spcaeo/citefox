/** Tracked pages and the stored page read. */

import { isOneOf } from './one-of'
import type { IntervalDays, SampleCount } from './settings'

/**
 * Section 10 `pages.status`.
 * Spaces in the SRS are underscores here, matching `spread_evenly`.
 */
const PAGE_STATUSES = ['not_tracked', 'setting_up', 'tracked', 'paused', 'removed'] as const

export type PageStatus = (typeof PAGE_STATUSES)[number]

/**
 * Section 10 `pages.kind` (Docs/TOPICS-SPEC.md section 2). `page` is one URL.
 * `topic` is a tracked subject with no single URL: its `url` is null, its
 * `title` is the topic name, and its prompts carry their own target pages.
 */
const PAGE_KINDS = ['page', 'topic'] as const

export type PageKind = (typeof PAGE_KINDS)[number]

export function isPageKind(value: string): value is PageKind {
  return isOneOf(PAGE_KINDS, value)
}

/** FR-1.7. The four setup steps, in order. `check` is recorded here; running it is M3. */
const PAGE_SETUP_STEPS = ['read', 'profile', 'prompts', 'check'] as const

export type PageSetupStep = (typeof PAGE_SETUP_STEPS)[number]

/** FR-2.1 and FR-2.9. How the stored snapshot was obtained. */
const PAGE_READ_METHODS = ['direct', 'jina', 'file'] as const

export type PageReadMethod = (typeof PAGE_READ_METHODS)[number]

/**
 * What `pages:readStart` asks for.
 * `auto` follows the app `jinaMode` (FR-2.5). The others force one reader.
 */
const PAGE_READ_READERS = ['auto', 'direct', 'jina', 'file'] as const

export type PageReadReader = (typeof PAGE_READ_READERS)[number]

/** Phases pushed on `pages:readProgress`. */
const PAGE_READ_PHASES = ['fetch', 'extract', 'summary'] as const

export type PageReadPhase = (typeof PAGE_READ_PHASES)[number]

/** `running` while the phase is in flight, then `ok` or `warning`. */
const WORK_PROGRESS_STATES = ['running', 'ok', 'warning'] as const

export type WorkProgressState = (typeof WORK_PROGRESS_STATES)[number]

/**
 * FR-2.2 asks for H2 and H3. The page-read mock-up also shows the opening
 * paragraph, a callout, and the closing call to action.
 */
const OUTLINE_LEVELS = ['p', 'box', 'h2', 'h3', 'cta'] as const

export type OutlineLevel = (typeof OUTLINE_LEVELS)[number]

/** FR-2.4. */
const PAGE_READ_FLAG_CODES = [
  'title_long',
  'meta_long',
  'title_differs_from_h1',
  'promise_mismatch'
] as const

export type PageReadFlagCode = (typeof PAGE_READ_FLAG_CODES)[number]

/**
 * FR-2.4. "About 60 characters" and "about 160 characters".
 * The flags use these exact cutoffs.
 */
export const TITLE_FLAG_LENGTH = 60

export const META_FLAG_LENGTH = 160

/**
 * A page row the sidebar and the page header share (section 10 `pages`).
 * `label` is the short sidebar name. Null means the UI uses `title`, then the URL.
 * `score` is the default-market visibility score. Null until a check exists (M3).
 * `clusterId` is site structure (M5) and is not on this type.
 * A topic (`kind: 'topic'`) has `url` null and its name in `title`.
 */
export interface PageSummary {
  id: string
  projectId: string
  /** The page address. Null only for a topic, which has no single URL. */
  url: string | null
  /** Absent or `page` for a page; `topic` for a topic. Storage always sets it. */
  kind?: PageKind
  title: string | null
  label: string | null
  folder: string | null
  status: PageStatus
  /** First unfinished setup step. Null once setup is finished (FR-1.7). */
  setupStep: PageSetupStep | null
  intervalDays: IntervalDays
  samples: SampleCount
  promptCount: number
  defaultMarketId: string | null
  pinned: boolean
  score: number | null
  /** Saved prompt-set version. Null before the first save. */
  promptSetVersion: number | null
}

/** One line of the page outline (FR-2.2). */
export interface OutlineEntry {
  level: OutlineLevel
  text: string
  /** True when this entry introduces a table. */
  table: boolean
}

/** One FAQ extracted from FAQPage schema or a FAQs heading (FR-2.2, FR-2.7). */
export interface PageFaq {
  question: string
  answer: string
  /** Set when the question has an obvious typo, such as a trailing "??". */
  typo: string | null
}

/** FR-2.4. `preview` is how Google cuts a long title. Null for the other codes. */
export interface PageReadFlag {
  code: PageReadFlagCode
  message: string
  preview: string | null
}

/** One promise in "What the page is targeting" (FR-2.8). */
export interface PagePromise {
  title: string
  detail: string
}

/** Page-text summary. Not the body, and not a secret. */
export interface PagePromiseSummary {
  promises: readonly PagePromise[]
  /** Product sentence under the promises. Null when the page is not selling one. */
  product: string | null
}

export function isPageStatus(value: string): value is PageStatus {
  return isOneOf(PAGE_STATUSES, value)
}

export function isPageSetupStep(value: string): value is PageSetupStep {
  return isOneOf(PAGE_SETUP_STEPS, value)
}

export function isPageReadMethod(value: string): value is PageReadMethod {
  return isOneOf(PAGE_READ_METHODS, value)
}

export function isPageReadReader(value: string): value is PageReadReader {
  return isOneOf(PAGE_READ_READERS, value)
}

export function isPageReadPhase(value: string): value is PageReadPhase {
  return isOneOf(PAGE_READ_PHASES, value)
}

export function isWorkProgressState(value: string): value is WorkProgressState {
  return isOneOf(WORK_PROGRESS_STATES, value)
}

export function isOutlineLevel(value: string): value is OutlineLevel {
  return isOneOf(OUTLINE_LEVELS, value)
}

export function isPageReadFlagCode(value: string): value is PageReadFlagCode {
  return isOneOf(PAGE_READ_FLAG_CODES, value)
}
