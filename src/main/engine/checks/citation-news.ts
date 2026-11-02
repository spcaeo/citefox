import { isEngineId, type EngineId } from '@shared/domain'
import type { CitationNews } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'

/** AI Overview statuses where one of the user's own pages is a link. */
const OWN_CITED = `'page_cited', 'other_own_page'`

interface Counts {
  cited: number
  named: number
}

/** One sample's link to the user's site. */
interface Link {
  engine: EngineId
  position: number | null
  url: string | null
}

/**
 * What one just-scored question found for the user's own site, across its samples:
 * the AI Overview and any answer engines. `cited` when a link points at the user's
 * site, `named` when the text only names the brand, else null. Competitor links are
 * never counted: the statuses here are the user's own.
 */
export function citationNews(
  db: SqliteDatabase,
  input: { jobId: string; pageId: string; marketId: string; promptId: string; brand: string }
): CitationNews | null {
  const run = db
    .prepare('SELECT id FROM runs WHERE job_id = ? AND page_id = ? AND market_id = ?')
    .get(input.jobId, input.pageId, input.marketId) as { id: string } | undefined
  if (run === undefined) return null
  const aio = db
    .prepare(
      `SELECT COALESCE(SUM(status IN (${OWN_CITED})), 0) AS cited,
              COALESCE(SUM(named = 1 OR status = 'brand_mentioned'), 0) AS named
         FROM serp_results WHERE run_id = ? AND prompt_id = ?`
    )
    .get(run.id, input.promptId) as Counts
  const answers = db
    .prepare(
      `SELECT COALESCE(SUM(status = 'cited'), 0) AS cited,
              COALESCE(SUM(named = 1 OR status = 'named'), 0) AS named
         FROM engine_answers WHERE run_id = ? AND prompt_id = ?`
    )
    .get(run.id, input.promptId) as Counts
  const cited = aio.cited + answers.cited > 0
  if (!cited && aio.named + answers.named === 0) return null
  const link = cited ? bestLink(db, run.id, input.promptId) : null
  return {
    kind: cited ? 'cited' : 'named',
    brand: input.brand,
    promptText: promptText(db, input),
    position: link?.position ?? null,
    engine: link?.engine ?? null,
    url: link?.url ?? null,
    firstEver: cited && !citedBefore(db, input.jobId)
  }
}

/**
 * The best link to the user's site: the lowest link number on any engine, Google AI
 * Overview first on a tie, and a link with no number last.
 */
function bestLink(db: SqliteDatabase, runId: string, promptId: string): Link | null {
  const order = 'ORDER BY position IS NULL, position LIMIT 1'
  const aio = db
    .prepare(
      `SELECT position, cited_url AS url FROM serp_results
        WHERE run_id = ? AND prompt_id = ? AND status IN (${OWN_CITED}) ${order}`
    )
    .get(runId, promptId) as Omit<Link, 'engine'> | undefined
  const answer = db
    .prepare(
      `SELECT engine, position, cited_url AS url FROM engine_answers
        WHERE run_id = ? AND prompt_id = ? AND status = 'cited' ${order}`
    )
    .get(runId, promptId) as (Omit<Link, 'engine'> & { engine: string }) | undefined
  const fromAio: Link | null = aio === undefined ? null : { ...aio, engine: 'google_aio' }
  const fromAnswer: Link | null =
    answer !== undefined && isEngineId(answer.engine) ? { ...answer, engine: answer.engine } : null
  if (fromAio === null || fromAnswer === null) return fromAio ?? fromAnswer
  if (fromAnswer.position === null) return fromAio
  return fromAio.position === null || fromAnswer.position < fromAio.position ? fromAnswer : fromAio
}

function promptText(
  db: SqliteDatabase,
  input: { jobId: string; pageId: string; marketId: string; promptId: string }
): string {
  const row = db
    .prepare(
      `SELECT prompt_text FROM check_steps
        WHERE job_id = ? AND page_id = ? AND market_id = ? AND prompt_id = ? AND prompt_text <> ''
        LIMIT 1`
    )
    .get(input.jobId, input.pageId, input.marketId, input.promptId) as
    { prompt_text: string } | undefined
  return row?.prompt_text ?? ''
}

/** True when a check before this one cited the user's site anywhere in the project. */
function citedBefore(db: SqliteDatabase, jobId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM runs r
        WHERE r.job_id <> ?
          AND (EXISTS (SELECT 1 FROM serp_results s WHERE s.run_id = r.id AND s.status IN (${OWN_CITED}))
               OR EXISTS (SELECT 1 FROM engine_answers e WHERE e.run_id = r.id AND e.status = 'cited'))
        LIMIT 1`
    )
    .get(jobId)
  return row !== undefined
}
