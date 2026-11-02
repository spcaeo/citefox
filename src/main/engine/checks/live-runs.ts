import type { CheckJobStatus } from '@shared/domain'
import type { LiveCheck, LiveRowState } from '@shared/ipc'
import {
  listStoredCheckRuns,
  listStoredMarketPrompts,
  type StoredCheckRun
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { filterFor } from './results'

/**
 * Runs whose results show before the check ends (owner, 2026-10-29: "if the data
 * has started coming in why can't we start showing that"). Each question's result
 * is stored when it is scored, so a reader can show it at once:
 *
 * - `finished`: a whole check, as before;
 * - `running`: its job is still running; the questions done so far are real results;
 * - `stopped`: the check ended part-way (stopped, out of credits, failed, or a quit
 *   that was not resumed). What it saved stays visible, marked as from a partial check.
 *
 * Trends and "since last check" never compare a running check: they wait for the
 * end. A stopped check is partial, so it never becomes "the previous check" either.
 */
export type RunState = 'finished' | 'running' | 'stopped'

export interface ReadableRun {
  run: StoredCheckRun
  state: RunState
}

interface JobRow {
  id: string
  status: string
  started_at: string
  finished_at: string | null
  prompt_ids: string | null
}

interface JobFacts {
  status: CheckJobStatus
  startedAt: string
  finishedAt: string | null
  promptIds: readonly string[] | null
}

/** The jobs behind these runs, by id. */
export function jobFacts(db: SqliteDatabase, jobIds: readonly string[]): Map<string, JobFacts> {
  const out = new Map<string, JobFacts>()
  const ids = [...new Set(jobIds)]
  for (let at = 0; at < ids.length; at += 400) {
    const part = ids.slice(at, at + 400)
    const rows = db
      .prepare<unknown[], JobRow>(
        `SELECT id, status, started_at, finished_at, prompt_ids FROM check_jobs
          WHERE id IN (${part.map(() => '?').join(', ')})`
      )
      .all(...part)
    for (const row of rows) {
      out.set(row.id, {
        status: row.status as CheckJobStatus,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        promptIds: parseIds(row.prompt_ids)
      })
    }
  }
  return out
}

function parseIds(encoded: string | null): readonly string[] | null {
  if (encoded === null) return null
  try {
    const parsed = JSON.parse(encoded) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : null
  } catch {
    return null
  }
}

export function runStateOf(run: StoredCheckRun, jobStatus: CheckJobStatus | undefined): RunState {
  if (run.status === 'finished') return 'finished'
  if (run.status === 'running' && jobStatus === 'running') return 'running'
  return 'stopped'
}

/**
 * Every run of one page in one market a results screen reads, oldest first:
 * finished, running and stopped. Cancelled runs are listed too (storage hides
 * them by default), since the answers they saved are real.
 */
export function readableRuns(
  db: SqliteDatabase,
  input: { projectId: string; pageId: string; marketId: string }
): ReadableRun[] {
  const listed = listStoredCheckRuns(db, filterFor(input.projectId, input.pageId, input.marketId))
  const cancelledIds = db
    .prepare<unknown[], { id: string }>(
      `SELECT id FROM runs WHERE page_id = ? AND market_id = ? AND status = 'cancelled'
          AND google_aio = 1`
    )
    .all(input.pageId, input.marketId)
    .map((row) => row.id)
  const cancelled = cancelledIds.flatMap((id) =>
    listStoredCheckRuns(db, filterFor(input.projectId, null, null, id))
  )
  const runs = [...listed, ...cancelled].filter(
    (run) => run.pageId === input.pageId && run.marketId === input.marketId
  )
  const jobs = jobFacts(
    db,
    runs.map((run) => run.jobId)
  )
  return runs
    .map((run) => ({ run, state: runStateOf(run, jobs.get(run.jobId)?.status) }))
    .sort((a, b) => orderAt(a.run).localeCompare(orderAt(b.run)))
}

/** When a run's results count from: its finish, or its start while it has none. */
export function orderAt(run: StoredCheckRun): string {
  return run.finishedAt ?? run.startedAt
}

/** One run's questions: planned, scored, and the ones being searched now. */
export interface RunProgress {
  /** Prompt ids the run sets out to check, in order. */
  planned: readonly string[]
  /** Prompt ids with a scored result (analysis step done). */
  done: ReadonlySet<string>
  /** Prompt ids being searched now. */
  checking: ReadonlySet<string>
}

/** What a running or stopped run has done so far, from its stored check steps. */
export function runProgress(
  db: SqliteDatabase,
  run: StoredCheckRun,
  promptIds: readonly string[] | null
): RunProgress {
  const wanted = promptIds === null ? null : new Set(promptIds)
  const planned = listStoredMarketPrompts(db, run.promptSetId, run.marketId)
    .filter((prompt) => prompt.enabled && (wanted === null || wanted.has(prompt.id)))
    .map((prompt) => prompt.id)
  const steps = db
    .prepare<unknown[], { prompt_id: string; phase: string; state: string }>(
      `SELECT prompt_id, phase, state FROM check_steps
        WHERE job_id = ? AND page_id = ? AND market_id = ?`
    )
    .all(run.jobId, run.pageId, run.marketId)
  const done = new Set<string>()
  const started = new Set<string>()
  for (const step of steps) {
    if (step.phase === 'analysis') {
      if (step.state === 'ok' || step.state === 'warning' || step.state === 'error') {
        done.add(step.prompt_id)
      }
    } else if (step.phase !== 'reread') {
      started.add(step.prompt_id)
    }
  }
  const checking = new Set([...started].filter((id) => !done.has(id)))
  return { planned, done, checking }
}

/** Prompt ids among these that are topic keywords (the rest are questions). */
export function keywordIds(db: SqliteDatabase, promptIds: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (let at = 0; at < promptIds.length; at += 400) {
    const part = promptIds.slice(at, at + 400)
    if (part.length === 0) continue
    for (const row of db
      .prepare<unknown[], { prompt_id: string }>(
        `SELECT prompt_id FROM topic_prompts
          WHERE kind = 'keyword' AND prompt_id IN (${part.map(() => '?').join(', ')})`
      )
      .all(...part)) {
      out.add(row.prompt_id)
    }
  }
  return out
}

/** The `LiveCheck` a screen shows for one running or stopped run. */
export function liveCheckOf(
  db: SqliteDatabase,
  readable: ReadableRun
): { live: LiveCheck; progress: RunProgress } | null {
  if (readable.state === 'finished') return null
  const { run } = readable
  const job = jobFacts(db, [run.jobId]).get(run.jobId)
  const progress = runProgress(db, run, job?.promptIds ?? null)
  const keywords = keywordIds(db, progress.planned)
  const count = (keyword: boolean): { done: number; total: number } => {
    const mine = progress.planned.filter((id) => keywords.has(id) === keyword)
    return { done: mine.filter((id) => progress.done.has(id)).length, total: mine.length }
  }
  const questions = count(false)
  const kws = count(true)
  return {
    live: {
      state: readable.state,
      jobId: run.jobId,
      done: questions.done + kws.done,
      total: questions.total + kws.total,
      questions,
      keywords: kws,
      startedAt: run.startedAt,
      endedAt: readable.state === 'stopped' ? (run.finishedAt ?? job?.finishedAt ?? null) : null
    },
    progress
  }
}

/** A question of a running check without its result yet: being searched, or waiting. */
export function liveRowState(progress: RunProgress, promptId: string): LiveRowState | null {
  if (progress.done.has(promptId) || !progress.planned.includes(promptId)) return null
  return progress.checking.has(promptId) ? 'checking' : 'waiting'
}

/**
 * Several pages' and topics' live checks as one: every running one added up; with
 * none running, the newest one that stopped part-way. Null when there is neither.
 */
export function combineLive(lives: readonly LiveCheck[]): LiveCheck | null {
  const running = lives.filter((item) => item.state === 'running')
  if (running.length === 0) {
    return (
      [...lives].sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? '')).at(-1) ?? null
    )
  }
  const sum = (pick: (item: LiveCheck) => number): number =>
    running.reduce((total, item) => total + pick(item), 0)
  const first = running[0] as LiveCheck
  return {
    state: 'running',
    jobId: first.jobId,
    done: sum((item) => item.done),
    total: sum((item) => item.total),
    questions: {
      done: sum((item) => item.questions.done),
      total: sum((item) => item.questions.total)
    },
    keywords: {
      done: sum((item) => item.keywords.done),
      total: sum((item) => item.keywords.total)
    },
    startedAt: running.map((item) => item.startedAt).sort()[0] ?? first.startedAt,
    endedAt: null
  }
}
