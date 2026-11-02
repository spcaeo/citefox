/**
 * The work console (owner: "love this mockup", Work console Main/States boards):
 * one DOS-style window for every long job the app reports, a `C:\CITEFOX\…>`
 * prompt per stage, floating over the app, minimisable to a pill.
 */

/** What a job is, for its prompt (`C:\CITEFOX\CHECKS>`) and its tab. */
export type JobKind = 'checks' | 'fill' | 'pages' | 'ai' | 'topics' | 'exports' | 'setup' | 'start'

export type LineState = 'running' | 'ok' | 'skipped' | 'warning' | 'error'

/**
 * One line of a job's log. A `stage` line is the prompt (`C:\CITEFOX\FILL\READ>
 * read pages`); `step` lines sit under it (`✓ /pricing 1.1 s`); an `error`
 * line is red and says what to do next.
 */
export interface ConsoleLine {
  id: string
  kind: 'stage' | 'step' | 'error'
  /** The stage this line belongs to, upper case (`READ`). */
  stage: string
  text: string
  state: LineState
  detail: string | null
  startedAt: number
  endedAt: number | null
}

/**
 * The work a job does side by side right now, under its stage line (a check runs a
 * few questions at once): one row per running item, replaced by each update.
 */
export interface ConsoleLive {
  /** One plain sentence of what the job is for, at the top of the list. */
  purpose: string | null
  rows: readonly ConsoleLiveRow[]
  /** The item finished last, kept briefly under the running ones ("Q8 cited ✓"). */
  lastDone: { id: string; label: string; cited: boolean | null; at: number } | null
}

export interface ConsoleLiveRow {
  id: string
  /** "Q9" or "K3". */
  label: string
  /** "Problem". Null when there is none. */
  stage: string | null
  /** The full words being searched (copyable). */
  text: string
  /** Who is asked: answered ones ticked, the rest still waiting. */
  engines: readonly { name: string; state: 'waiting' | 'ok' | 'cited' | 'failed' }[]
  startedAt: number
}

/** What "retry" does for a job that supports it. */
export type RetrySpec =
  { kind: 'check'; projectId: string; pageId: string } | { kind: 'setup'; pageId: string }

/** What "Stop" does for a job that supports it. */
export type StopSpec = { kind: 'check'; jobId: string } | { kind: 'start'; projectId: string }

export type JobStatus = 'running' | 'done' | 'error'

export interface ConsoleJob {
  id: string
  kind: JobKind
  /** The tab and pill name: "Fill from example.com", "Check". */
  title: string
  /** The first line after `C:\CITEFOX>`: "fill example.com". */
  command: string
  status: JobStatus
  startedAt: number
  updatedAt: number
  endedAt: number | null
  lines: readonly ConsoleLine[]
  progress: { done: number; total: number } | null
  /** "31 suggestions", "12 of 12 questions checked". */
  summary: string | null
  /** The last error, in plain words, with the next step. */
  error: { message: string; nextStep: string | null } | null
  retry: RetrySpec | null
  stop: StopSpec | null
  /** A job with no end event counts as done once it has been quiet this long. */
  settleMs: number
  /** Usual length, for "72 s / about 90 s". Null when unknown. */
  expectedMs: number | null
  /**
   * CiteFox started it on its own (a suggestion on screen load), not the user: it is
   * listed in Activity but never opens the window or keeps it open after an error.
   */
  background: boolean
  /** The items running side by side now. Null when the job reports none. */
  live: ConsoleLive | null
}

/** One report from a progress stream, already turned into console words. */
export interface ConsoleUpdate {
  jobId: string
  kind: JobKind
  title: string
  command: string
  at: number
  /** Upper-case stage name; a new stage starts a new prompt line. */
  stage?: string
  /** The words after the stage prompt ("search the web, US"). */
  stageText?: string
  /** A step under the current stage, updated in place by id. */
  step?: {
    id: string
    text: string
    state: LineState
    detail: string | null
    startedAt: number
    endedAt: number | null
  }
  progress?: { done: number; total: number } | null
  /** `running` keeps the job going; `ok`/`warning` are quiet moments; `error` is red. */
  state: LineState
  /** True when the stream says the job is over. */
  final?: boolean
  summary?: string | null
  error?: { message: string; nextStep: string | null } | null
  retry?: RetrySpec | null
  stop?: StopSpec | null
  settleMs?: number
  expectedMs?: number | null
  /**
   * Join the newest running job of this kind instead (a page read's Claude
   * steps arrive on their own run), else start `jobId`.
   */
  attachTo?: JobKind
  /** Work the user did not start (see `ConsoleJob.background`). */
  background?: boolean
  /** Replaces the job's running list; null clears it. */
  live?: ConsoleLive | null
}

/** `hidden`: nothing on screen. `open`: the window. `min`: the pill in the corner. */
export type ConsoleMode = 'hidden' | 'open' | 'min'

/** The minimised pill's news: a job finished (green) or failed (red). */
export type ConsoleAttention = 'none' | 'done' | 'error'

export interface ConsolePosition {
  x: number
  y: number
}

export interface ConsoleState {
  jobs: readonly ConsoleJob[]
  activeJobId: string | null
  mode: ConsoleMode
  /** The user minimised last time: new work shows as the pill, not the window. */
  prefersMin: boolean
  /** "Close when done": count down and close once every job is over. Off = pinned open. */
  closeWhenDone: boolean
  attention: ConsoleAttention
  /** Bumped on each finish while minimised, so the pill shakes again. */
  shakeKey: number
  /** When the window closes itself (epoch ms), or null. */
  closingAt: number | null
  /** A job failed since the window was last closed: never close by itself. */
  errorPending: boolean
  position: ConsolePosition | null
  /**
   * The first-run setup screens are showing: they show their own progress, so
   * new work (except a check) stays in the Activity button instead of opening.
   */
  quiet: boolean
}

/** Saved per user (localStorage): where it was dragged and how it should behave. */
export interface ConsolePrefs {
  prefersMin: boolean
  closeWhenDone: boolean
  position: ConsolePosition | null
}
