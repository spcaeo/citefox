import type { DeletedCheck } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import { CheckInputError } from '../checks/results'

/**
 * `history:delete` (Check history): removes one check (run) and everything
 * saved for it, in one transaction, so its results leave history, trends and
 * reports together and nothing points at a run that is gone.
 *
 * - Refused while the run, or the job it belongs to, is still running: the
 *   engine is writing to it. Cancel first.
 * - The job row stays: it is the record of the searches the check used, and
 *   searches already used are not refunded (usage lives in the app database).
 *   Only this page × market's step rows of the job go.
 * - A fix whose follow-up was this run is linked to another finished run of the
 *   same job and page, or goes back to waiting for its follow-up check.
 * - A market whose baseline was this run has no baseline until its next full check.
 */
export function deleteCheckRun(db: SqliteDatabase, runId: string): DeletedCheck {
  const run = db
    .prepare<
      unknown[],
      { id: string; job_id: string; page_id: string; market_id: string; status: string }
    >('SELECT id, job_id, page_id, market_id, status FROM runs WHERE id = ?')
    .get(runId)
  if (run === undefined) throw new CheckInputError('That check was not found')
  const job = db
    .prepare<unknown[], { status: string }>('SELECT status FROM check_jobs WHERE id = ?')
    .get(run.job_id)
  if (run.status === 'running' || job?.status === 'running') {
    throw new CheckInputError(
      'That check is still running. Cancel it or wait for it to finish, then delete it.'
    )
  }
  return db.transaction((): DeletedCheck => {
    const samples = db
      .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM serp_results WHERE run_id = ?')
      .get(runId)
    // Sentiment reads, their claims and brand captures of this run.
    db.prepare('DELETE FROM claims WHERE run_id = ?').run(runId)
    db.prepare('DELETE FROM sentiment_reads WHERE run_id = ?').run(runId)
    db.prepare('DELETE FROM brand_captures WHERE run_id = ?').run(runId)
    db.prepare('DELETE FROM analyses WHERE run_id = ?').run(runId)
    db.prepare('DELETE FROM topic_summaries WHERE run_id = ?').run(runId)
    // Each sample's saved Claude read and AI Overview sources, then the samples.
    const inRun = 'SELECT id FROM serp_results WHERE run_id = ?'
    db.prepare(`DELETE FROM overview_reads WHERE serp_result_id IN (${inRun})`).run(runId)
    db.prepare(`DELETE FROM aio_references WHERE serp_result_id IN (${inRun})`).run(runId)
    db.prepare('DELETE FROM serp_results WHERE run_id = ?').run(runId)
    // Answer engines' replies and their sources.
    const answers = 'SELECT id FROM engine_answers WHERE run_id = ?'
    db.prepare(`DELETE FROM engine_sources WHERE answer_id IN (${answers})`).run(runId)
    db.prepare('DELETE FROM engine_answers WHERE run_id = ?').run(runId)
    relinkFixes(db, run)
    db.prepare('UPDATE page_markets SET baseline_run_id = NULL WHERE baseline_run_id = ?').run(
      runId
    )
    db.prepare('DELETE FROM check_steps WHERE job_id = ? AND page_id = ? AND market_id = ?').run(
      run.job_id,
      run.page_id,
      run.market_id
    )
    db.prepare('DELETE FROM runs WHERE id = ?').run(runId)
    return { runId, samples: samples?.n ?? 0 }
  })()
}

function relinkFixes(
  db: SqliteDatabase,
  run: { id: string; job_id: string; page_id: string }
): void {
  const sibling = db
    .prepare<unknown[], { id: string }>(
      `SELECT id FROM runs
       WHERE job_id = ? AND page_id = ? AND id != ? AND status = 'finished'
       ORDER BY started_at ASC, rowid ASC LIMIT 1`
    )
    .get(run.job_id, run.page_id, run.id)
  if (sibling !== undefined) {
    db.prepare('UPDATE fixes SET followup_run_id = ? WHERE followup_run_id = ?').run(
      sibling.id,
      run.id
    )
    return
  }
  // No other result of that follow-up: the fix waits for a follow-up check again.
  db.prepare(
    `UPDATE fixes SET followup_run_id = NULL, verdict = NULL, followup_job_id = NULL
     WHERE followup_run_id = ?`
  ).run(run.id)
}
