import type { SetupRunStep } from '@shared/ipc'
import { redactString } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireUtcTimestamp } from './values'

/** Project migration 024. Where the background runner is with one page. */
export type PageSetupState = 'running' | 'retry' | 'failed' | 'done'

export interface PageSetupJob {
  pageId: string
  state: PageSetupState
  step: SetupRunStep
  attempts: number
  /** ISO-8601 UTC. Set for `retry`. */
  nextAttemptAt: string | null
  lastError: string | null
  nextStep: string | null
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

/**
 * One `setting_up` page the runner may pick, with what decides when: its first
 * check hold (SCH-12), when it was tracked, and when the Add-page stepper last
 * touched it (read, profile, or prompts).
 */
export interface SetupCandidate {
  pageId: string
  url: string
  label: string | null
  title: string | null
  hasSnapshot: boolean
  hasProfile: boolean
  promptSetVersion: number | null
  /** Earliest market `added_at`. ISO-8601 UTC, or null when the page has no market. */
  trackedAt: string | null
  /** Earliest `first_check_not_before` among unchecked markets. Null when not held. */
  firstCheckNotBefore: string | null
  /** Newest of snapshot, buyer profile, and prompt set times. Null when none. */
  lastActivityAt: string | null
  job: PageSetupJob | null
}

interface JobSql {
  page_id: string
  state: string
  step: string
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
  next_step: string | null
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

interface CandidateSql {
  id: string
  url: string
  label: string | null
  title: string | null
  has_snapshot: number
  has_profile: number
  active_version: number | null
  tracked_at: string | null
  hold: string | null
  snapshot_at: string | null
  profile_at: string | null
  prompts_at: string | null
}

const STATES: ReadonlySet<string> = new Set(['running', 'retry', 'failed', 'done'])
const STEPS: ReadonlySet<string> = new Set(['read', 'profile', 'prompts', 'coverage'])

const CANDIDATE_SELECT = `SELECT pages.id, pages.url, pages.label, pages.title,
         EXISTS (SELECT 1 FROM snapshots WHERE snapshots.page_id = pages.id) AS has_snapshot,
         EXISTS (SELECT 1 FROM buyer_profiles WHERE buyer_profiles.page_id = pages.id) AS has_profile,
         (SELECT version FROM prompt_sets
           WHERE prompt_sets.page_id = pages.id AND prompt_sets.is_active = 1) AS active_version,
         (SELECT MIN(added_at) FROM page_markets WHERE page_markets.page_id = pages.id) AS tracked_at,
         (SELECT MIN(first_check_not_before) FROM page_markets
           WHERE page_markets.page_id = pages.id AND last_checked_at IS NULL) AS hold,
         (SELECT MAX(fetched_at) FROM snapshots WHERE snapshots.page_id = pages.id) AS snapshot_at,
         (SELECT MAX(created_at) FROM buyer_profiles
           WHERE buyer_profiles.page_id = pages.id) AS profile_at,
         (SELECT MAX(saved_at) FROM prompt_sets WHERE prompt_sets.page_id = pages.id) AS prompts_at
       FROM pages`

/** Every page still setting up, with its runner row. One query for pages, one for rows. */
export function listSetupCandidates(db: SqliteDatabase): SetupCandidate[] {
  const rows = db
    .prepare<unknown[], CandidateSql>(
      `${CANDIDATE_SELECT} WHERE status = 'setting_up' ORDER BY rowid ASC`
    )
    .all()
  const jobs = new Map(listPageSetupJobs(db).map((job) => [job.pageId, job]))
  return rows.map((row) => candidateFromSql(row, jobs.get(row.id) ?? null))
}

/**
 * One working page as a candidate, whatever its status: a tracked page asked to
 * fill a missing step (such as content gaps) runs through the same runner.
 */
export function getSetupCandidate(db: SqliteDatabase, pageId: string): SetupCandidate | null {
  const row = db
    .prepare<unknown[], CandidateSql>(
      `${CANDIDATE_SELECT} WHERE id = ? AND status IN ('setting_up', 'tracked', 'paused')`
    )
    .get(assertId(pageId))
  return row === undefined ? null : candidateFromSql(row, getPageSetupJob(db, pageId))
}

function candidateFromSql(row: CandidateSql, job: PageSetupJob | null): SetupCandidate {
  return {
    pageId: row.id,
    url: row.url,
    label: row.label,
    title: row.title,
    hasSnapshot: row.has_snapshot === 1,
    hasProfile: row.has_profile === 1,
    promptSetVersion: row.active_version,
    trackedAt: row.tracked_at,
    firstCheckNotBefore: row.hold,
    lastActivityAt: newest([row.snapshot_at, row.profile_at, row.prompts_at]),
    job
  }
}

/** Removes the page's row (Retry or Resume from the page). Returns true when there was one. */
export function deletePageSetupJob(db: SqliteDatabase, pageId: string): boolean {
  return (
    db.prepare(`DELETE FROM page_setup_jobs WHERE page_id = ?`).run(assertId(pageId)).changes > 0
  )
}

export function listPageSetupJobs(db: SqliteDatabase): PageSetupJob[] {
  return db
    .prepare<unknown[], JobSql>(`SELECT * FROM page_setup_jobs ORDER BY updated_at DESC`)
    .all()
    .map(jobFromSql)
}

export function getPageSetupJob(db: SqliteDatabase, pageId: string): PageSetupJob | null {
  const row = db
    .prepare<unknown[], JobSql>(`SELECT * FROM page_setup_jobs WHERE page_id = ?`)
    .get(assertId(pageId))
  return row === undefined ? null : jobFromSql(row)
}

/** Inserts or replaces the page's row. Text is redacted and clipped before it is stored. */
export function writePageSetupJob(db: SqliteDatabase, job: PageSetupJob): void {
  if (!STATES.has(job.state)) throw new StorageError('Invalid setup state')
  if (!STEPS.has(job.step)) throw new StorageError('Invalid setup step')
  if (!Number.isInteger(job.attempts) || job.attempts < 0) {
    throw new StorageError('Invalid setup attempts')
  }
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO page_setup_jobs (page_id, state, step, attempts, next_attempt_at,
             last_error, next_step, started_at, finished_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (page_id) DO UPDATE SET
             state = excluded.state, step = excluded.step, attempts = excluded.attempts,
             next_attempt_at = excluded.next_attempt_at, last_error = excluded.last_error,
             next_step = excluded.next_step, started_at = excluded.started_at,
             finished_at = excluded.finished_at, updated_at = excluded.updated_at`
        )
        .run(
          assertId(job.pageId),
          job.state,
          job.step,
          job.attempts,
          optionalTime(job.nextAttemptAt),
          clipText(job.lastError, 500),
          clipText(job.nextStep, 300),
          optionalTime(job.startedAt),
          optionalTime(job.finishedAt),
          requireUtcTimestamp(job.updatedAt)
        ),
    'Could not save page setup progress'
  )
}

/** `setup:retry`: failed and retrying pages start over with no attempts. Returns pages reset. */
export function resetPageSetupJobs(db: SqliteDatabase, pageIds: readonly string[] | null): number {
  if (pageIds === null) {
    return db.prepare(`DELETE FROM page_setup_jobs WHERE state IN ('failed', 'retry')`).run()
      .changes
  }
  const statement = db.prepare(
    `DELETE FROM page_setup_jobs WHERE page_id = ? AND state IN ('failed', 'retry')`
  )
  let changed = 0
  for (const id of pageIds) changed += statement.run(assertId(id)).changes
  return changed
}

/** Pages finished at or after `since` (ISO-8601 UTC). */
export function countSetupDoneSince(db: SqliteDatabase, since: string): number {
  const row = db
    .prepare<unknown[], { n: number }>(
      `SELECT COUNT(*) AS n FROM page_setup_jobs WHERE state = 'done' AND finished_at >= ?`
    )
    .get(requireUtcTimestamp(since))
  return row?.n ?? 0
}

/** A page finished at or after `since`. `url` is empty when the page was removed since. */
export interface SetupDonePage {
  pageId: string
  url: string
  label: string | null
  title: string | null
}

/** The pages {@link countSetupDoneSince} counts, oldest first. */
export function listSetupDoneSince(db: SqliteDatabase, since: string): SetupDonePage[] {
  return db
    .prepare<
      unknown[],
      { page_id: string; url: string | null; label: string | null; title: string | null }
    >(
      `SELECT j.page_id, p.url, p.label, p.title FROM page_setup_jobs j
       LEFT JOIN pages p ON p.id = j.page_id
       WHERE j.state = 'done' AND j.finished_at >= ?
       ORDER BY j.finished_at ASC`
    )
    .all(requireUtcTimestamp(since))
    .map((row) => ({ pageId: row.page_id, url: row.url ?? '', label: row.label, title: row.title }))
}

/** Start times at or after `since`, for the pages-per-hour throttle after a restart. */
export function listSetupStartsSince(db: SqliteDatabase, since: string): string[] {
  return db
    .prepare<unknown[], { started_at: string }>(
      `SELECT started_at FROM page_setup_jobs WHERE started_at IS NOT NULL AND started_at >= ?`
    )
    .all(requireUtcTimestamp(since))
    .map((row) => row.started_at)
}

function jobFromSql(row: JobSql): PageSetupJob {
  if (!STATES.has(row.state) || !STEPS.has(row.step)) {
    throw new StorageError('Invalid setup row')
  }
  return {
    pageId: row.page_id,
    state: row.state as PageSetupState,
    step: row.step as SetupRunStep,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    nextStep: row.next_step,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at
  }
}

function newest(values: ReadonlyArray<string | null>): string | null {
  let best: string | null = null
  for (const value of values) {
    if (value !== null && (best === null || value > best)) best = value
  }
  return best
}

function optionalTime(value: string | null): string | null {
  return value === null ? null : requireUtcTimestamp(value)
}

function clipText(value: string | null, max: number): string | null {
  if (value === null) return null
  const clean = redactString(value, { hexKeys: true }).trim()
  if (clean.length === 0) return null
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}
