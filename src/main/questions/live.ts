import { isPromptCheckStatus } from '@shared/domain'
import type { LiveCheck, LiveRowState } from '@shared/ipc'
import {
  combineLive,
  jobFacts,
  liveCheckOf,
  liveRowState,
  runStateOf,
  type RunProgress,
  type RunState
} from '../engine/checks/live-runs'
import { filterFor } from '../engine/checks/results'
import { listStoredCheckRuns, type StoredCheckRun } from '../storage/check-records'
import type { SqliteDatabase } from '../storage/database'
import type { LeanSample } from './reads'

/**
 * Questions reads checks still running, and ones that stopped part-way, next to
 * finished ones (see `engine/checks/live-runs.ts`): a question shows its answer as
 * soon as it is scored, and the questions still to come say "waiting" or "checking…".
 */
export interface QuestionRuns {
  /** Oldest first, by start. */
  runs: StoredCheckRun[]
  states: ReadonlyMap<string, RunState>
}

/** Every run in the market with results to read: finished, running and stopped. */
export function questionRuns(
  db: SqliteDatabase,
  projectId: string,
  marketId: string
): QuestionRuns {
  const listed = listStoredCheckRuns(db, filterFor(projectId, null, marketId))
  const cancelled = db
    .prepare<unknown[], { id: string }>(
      `SELECT id FROM runs WHERE market_id = ? AND status = 'cancelled' AND google_aio = 1`
    )
    .all(marketId)
    .flatMap((row) => listStoredCheckRuns(db, filterFor(projectId, null, null, row.id)))
  const runs = [...listed, ...cancelled].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const jobs = jobFacts(
    db,
    runs.map((run) => run.jobId)
  )
  return {
    runs,
    states: new Map(runs.map((run) => [run.id, runStateOf(run, jobs.get(run.jobId)?.status)]))
  }
}

/**
 * Every capture of those runs. A finished run's all count; a running or stopped run's
 * question counts once all its samples are in, so a half-searched question never shows.
 */
export function readQuestionSamples(
  db: SqliteDatabase,
  marketId: string,
  read: QuestionRuns
): LeanSample[] {
  const rows = db
    .prepare<
      unknown[],
      {
        id: string
        run_id: string
        prompt_id: string
        sample_no: number
        status: string
        named: number | null
        cited_url: string | null
        position: number | null
      }
    >(
      `SELECT serp_results.id, serp_results.run_id, serp_results.prompt_id,
              serp_results.sample_no, serp_results.status, serp_results.named,
              serp_results.cited_url, serp_results.position
       FROM serp_results
       JOIN runs ON runs.id = serp_results.run_id
       WHERE runs.market_id = ?`
    )
    .all(marketId)
  const samples: LeanSample[] = rows.flatMap((row) =>
    read.states.has(row.run_id) && isPromptCheckStatus(row.status)
      ? [
          {
            id: row.id,
            runId: row.run_id,
            promptId: row.prompt_id,
            sampleNo: row.sample_no,
            status: row.status,
            named: row.named === null ? null : row.named === 1,
            citedUrl: row.cited_url,
            position: row.position
          }
        ]
      : []
  )
  const wanted = new Map(read.runs.map((run) => [run.id, run.samples]))
  const counts = new Map<string, number>()
  for (const sample of samples) {
    const key = `${sample.runId}|${sample.promptId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return samples.filter(
    (sample) =>
      read.states.get(sample.runId) === 'finished' ||
      (counts.get(`${sample.runId}|${sample.promptId}`) ?? 0) >= (wanted.get(sample.runId) ?? 1)
  )
}

/** The running checks in the market: their questions done so far, and each waiting one. */
export function liveQuestions(
  db: SqliteDatabase,
  read: QuestionRuns
): {
  live: LiveCheck | null
  rowState: (promptId: string, resultRunId: string | null) => LiveRowState | null
} {
  const running: { runId: string; progress: RunProgress; live: LiveCheck }[] = []
  for (const run of read.runs) {
    const state = read.states.get(run.id)
    if (state !== 'running') continue
    const found = liveCheckOf(db, { run, state })
    if (found !== null) running.push({ runId: run.id, progress: found.progress, live: found.live })
  }
  return {
    live: combineLive(running.map((item) => item.live)),
    rowState: (promptId, resultRunId) => {
      for (const item of running) {
        if (item.runId === resultRunId) return null
        const state = liveRowState(item.progress, promptId)
        if (state !== null) return state
      }
      return null
    }
  }
}
