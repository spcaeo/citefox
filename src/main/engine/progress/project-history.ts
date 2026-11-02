import {
  isCheckRunKind,
  isCheckRunStatus,
  isSearchProvider,
  normaliseEngines,
  VISIBILITY_POINT_BRAND_MENTIONED,
  VISIBILITY_POINT_NOT_CITED,
  VISIBILITY_POINT_OTHER_OWN,
  VISIBILITY_POINT_PAGE_CITED,
  type EngineId,
  type PageSummary,
  type SearchProvider
} from '@shared/domain'
import type { HistorySubject, ProjectCheck, ProjectHistory } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { listMarkets } from '../../storage/project-profile'
import { scoreChanges, visibilityScore } from './score-change'

/**
 * `history:listProject` (Check history). Every check (run) of the project's open
 * pages and topics, newest first, with what it found.
 *
 * One SQL statement reads every run and its counts, so the screen costs the same
 * for 3 checks or 3,000 (no query per run). The counts follow Results exactly
 * (section 7.1, `rollupSamples`): per question, the most common sample status
 * wins, a tie takes the higher points and then the earlier sample, and an error
 * loses to any other status. `named` is read from the first winning sample, as
 * Results reads it. A row's numbers therefore match the Results it opens. The
 * score is section 7.2's points over the questions with an AI Overview, and its
 * change uses the page History tab's rule (`scoreChanges`), so the two agree.
 * A second statement lists the questions each ended check has no result for.
 */
export function buildProjectHistory(
  db: SqliteDatabase,
  input: { projectId: string; builtAt: string }
): ProjectHistory {
  const pages = listPages(db, input.projectId).filter((page) => page.status !== 'removed')
  const kinds = new Map(pages.map((page) => [page.id, page.kind === 'topic']))
  const rows = db
    .prepare<unknown[], CheckSql>(CHECKS_SQL)
    .all()
    .filter((row) => kinds.has(row.page_id))
  const changes = changesOf(rows)
  const failed = failedPrompts(db)
  const checks = rows.map((row) =>
    checkFromSql(row, kinds.get(row.page_id) === true, changes, failed.get(row.id) ?? [])
  )
  const checked = new Set(checks.map((check) => check.pageId))
  return {
    projectId: input.projectId,
    builtAt: input.builtAt,
    markets: listMarkets(db),
    subjects: pages.filter((page) => checked.has(page.id)).map(subjectOf),
    checks,
    trackedCount: pages.filter((page) => TRACKED.has(page.status)).length
  }
}

const TRACKED = new Set<string>(['setting_up', 'tracked', 'paused'])

/** Score change per finished run, per page and market, oldest first (as History reads them). */
function changesOf(rows: readonly CheckSql[]): Map<string, number | null> {
  const groups = new Map<string, CheckSql[]>()
  for (const row of rows) {
    if (row.status !== 'finished') continue
    const key = `${row.page_id}|${row.market_id}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [row])
    else group.push(row)
  }
  const out = new Map<string, number | null>()
  for (const group of groups.values()) {
    // Rows come newest first; History walks them oldest first.
    const ordered = [...group].reverse().map((row) => ({
      id: row.id,
      promptSetId: row.prompt_set_id,
      partial: row.partial === 1,
      score: scoreOf(row)
    }))
    for (const [id, change] of scoreChanges(ordered)) out.set(id, change)
  }
  return out
}

function scoreOf(row: CheckSql): number | null {
  if (row.status !== 'finished') return null
  return visibilityScore(row.points, row.aio * VISIBILITY_POINT_PAGE_CITED)
}

/**
 * Per ended run: the questions it meant to ask (a follow-up's list, else every
 * enabled question of its prompt set) with no saved result, or only errors.
 */
function failedPrompts(db: SqliteDatabase): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const row of db
    .prepare<unknown[], { run_id: string; prompt_id: string }>(FAILED_SQL)
    .all()) {
    const list = out.get(row.run_id)
    if (list === undefined) out.set(row.run_id, [row.prompt_id])
    else list.push(row.prompt_id)
  }
  return out
}

const FAILED_SQL = `
  WITH intended AS (
    SELECT runs.id AS run_id, prompts.id AS prompt_id, prompts.position
    FROM runs
    JOIN prompts ON prompts.prompt_set_id = runs.prompt_set_id AND prompts.enabled = 1
    LEFT JOIN check_jobs ON check_jobs.id = runs.job_id
    WHERE runs.status != 'running'
      AND runs.google_aio = 1
      AND (
        check_jobs.prompt_ids IS NULL
        OR prompts.id IN (SELECT value FROM json_each(check_jobs.prompt_ids))
      )
  ),
  answered AS (
    SELECT DISTINCT run_id, prompt_id FROM serp_results WHERE status != 'error'
  )
  SELECT intended.run_id, intended.prompt_id
  FROM intended
  LEFT JOIN answered
    ON answered.run_id = intended.run_id AND answered.prompt_id = intended.prompt_id
  WHERE answered.run_id IS NULL
  ORDER BY intended.run_id, intended.position
`

const AIO = `'page_cited', 'other_own_page', 'brand_mentioned', 'not_cited'`

/**
 * - `samples`: each saved sample of a question that is in its run's prompt set.
 * - `tally` / `ranked`: one winning status per run and question (section 7.1).
 * - `winners`: that status, the first winning sample's `named`, and whether that sample's
 *   AI Overview links to an own page (`own_link`, the shared "cited" rule).
 * - `counts`: per run. `searches` counts every saved sample, as the job does.
 * - `totals`: enabled questions per prompt set (Results' `promptsTotal`).
 * Removed pages are dropped in code, so the statement stays index-friendly.
 */
const CHECKS_SQL = `
  WITH samples AS (
    SELECT serp_results.id, serp_results.run_id, serp_results.prompt_id, serp_results.sample_no,
           serp_results.status, serp_results.named
    FROM serp_results
    JOIN runs ON runs.id = serp_results.run_id
    JOIN prompts ON prompts.id = serp_results.prompt_id
      AND prompts.prompt_set_id = runs.prompt_set_id
  ),
  tally AS (
    SELECT run_id, prompt_id, status, COUNT(*) AS n, MIN(sample_no) AS first_sample,
           CASE status
             WHEN 'page_cited' THEN ${VISIBILITY_POINT_PAGE_CITED}
             WHEN 'other_own_page' THEN ${VISIBILITY_POINT_OTHER_OWN}
             WHEN 'brand_mentioned' THEN ${VISIBILITY_POINT_BRAND_MENTIONED}
             WHEN 'not_cited' THEN ${VISIBILITY_POINT_NOT_CITED}
             ELSE -1
           END AS points
    FROM samples
    GROUP BY run_id, prompt_id, status
  ),
  ranked AS (
    SELECT run_id, prompt_id, status, first_sample, points,
           ROW_NUMBER() OVER (
             PARTITION BY run_id, prompt_id
             ORDER BY (status = 'error') ASC, n DESC, points DESC, first_sample ASC
           ) AS place
    FROM tally
  ),
  winners AS (
    SELECT ranked.run_id, ranked.status, samples.named, ranked.points,
           EXISTS (
             SELECT 1 FROM aio_references
             WHERE aio_references.serp_result_id = samples.id
               AND aio_references.classification IN ('target', 'own')
           ) AS own_link
    FROM ranked
    JOIN samples ON samples.run_id = ranked.run_id
      AND samples.prompt_id = ranked.prompt_id
      AND samples.sample_no = ranked.first_sample
    WHERE ranked.place = 1
  ),
  counts AS (
    SELECT run_id,
           COUNT(*) AS checked,
           SUM(status IN (${AIO})) AS aio,
           SUM(status = 'page_cited') AS cited_page,
           SUM(status = 'other_own_page') AS cited_other,
           SUM(status IN (${AIO}) AND own_link = 1) AS cited_own,
           SUM(status IN (${AIO}) AND named = 1) AS named,
           SUM(CASE WHEN status IN (${AIO}) THEN points ELSE 0 END) AS points
    FROM winners
    GROUP BY run_id
  ),
  searches AS (
    SELECT run_id, SUM(searches) AS used, SUM(credits) AS credits, SUM(cost_micros) AS cost,
           MAX(provider = 'cloro') AS on_cloro
    FROM serp_results GROUP BY run_id
  ),
  spent AS (
    SELECT run_id, SUM(credits) AS credits, SUM(cost_micros) AS cost FROM (
      SELECT run_id, credits, cost_micros FROM brand_captures
      UNION ALL
      SELECT run_id, credits, cost_micros FROM engine_answers
    ) GROUP BY run_id
  ),
  totals AS (
    SELECT prompt_set_id, COUNT(*) AS total FROM prompts WHERE enabled = 1 GROUP BY prompt_set_id
  )
  SELECT runs.id, runs.job_id, runs.page_id, runs.market_id, runs.snapshot_id, runs.kind,
         runs.partial, runs.status, runs.started_at, runs.finished_at, runs.prompt_set_id,
         runs.samples, check_jobs.prompt_ids,
         COALESCE(counts.checked, 0) AS checked,
         COALESCE(totals.total, 0) AS total,
         COALESCE(counts.aio, 0) AS aio,
         COALESCE(counts.cited_page, 0) AS cited_page,
         COALESCE(counts.cited_other, 0) AS cited_other,
         COALESCE(counts.cited_own, 0) AS cited_own,
         COALESCE(counts.named, 0) AS named,
         COALESCE(counts.points, 0) AS points,
         COALESCE(searches.used, 0) AS searches,
         COALESCE(searches.credits, 0) + COALESCE(spent.credits, 0) AS credits,
         COALESCE(searches.cost, 0) + COALESCE(spent.cost, 0) AS cost_micros,
         COALESCE(searches.on_cloro, 0) AS on_cloro,
         check_jobs.provider AS job_provider,
         runs.engines_json
  FROM runs
  LEFT JOIN check_jobs ON check_jobs.id = runs.job_id
  LEFT JOIN counts ON counts.run_id = runs.id
  LEFT JOIN searches ON searches.run_id = runs.id
  LEFT JOIN spent ON spent.run_id = runs.id
  LEFT JOIN totals ON totals.prompt_set_id = runs.prompt_set_id
  WHERE runs.google_aio = 1
  ORDER BY runs.started_at DESC, runs.rowid DESC
`

interface CheckSql {
  id: string
  job_id: string
  page_id: string
  market_id: string
  snapshot_id: string
  kind: string
  partial: number
  status: string
  started_at: string
  finished_at: string | null
  prompt_set_id: string
  samples: number
  prompt_ids: string | null
  checked: number
  total: number
  aio: number
  cited_page: number
  cited_other: number
  cited_own: number
  named: number
  points: number
  searches: number
  credits: number
  cost_micros: number
  on_cloro: number
  job_provider: string | null
  engines_json: string | null
}

function checkFromSql(
  row: CheckSql,
  topic: boolean,
  changes: ReadonlyMap<string, number | null>,
  failed: readonly string[]
): ProjectCheck {
  return {
    runId: row.id,
    jobId: row.job_id,
    pageId: row.page_id,
    marketId: row.market_id,
    snapshotId: row.snapshot_id,
    kind: isCheckRunKind(row.kind) ? row.kind : 'manual',
    partial: row.partial === 1,
    status: isCheckRunStatus(row.status) ? row.status : 'error',
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: durationOf(row.started_at, row.finished_at),
    questionsChecked: row.checked,
    questionsTotal: row.total,
    aiOverviews: row.aio,
    // A topic has no URL of its own: any page of the site counts as cited, by the one
    // rule every screen uses (an own link in the AI Overview, `isCitedState`), so the
    // row matches the topic's own count of the same check.
    cited: topic ? row.cited_own : row.cited_page,
    named: row.named,
    searchesUsed: row.searches,
    credits: row.credits,
    costMicros: row.cost_micros,
    provider: providerOf(row),
    engines: enginesOf(row.engines_json),
    score: scoreOf(row),
    scoreChange: changes.get(row.id) ?? null,
    samples: row.samples,
    promptIds: promptIdsOf(row.prompt_ids),
    failedPromptIds: failed
  }
}

/** Who ran the Google search: the job's provider, else cloro if any sample came from it. */
function providerOf(row: CheckSql): SearchProvider {
  if (isSearchProvider(row.job_provider)) return row.job_provider
  return row.on_cloro === 1 ? 'cloro' : 'serpapi'
}

function enginesOf(json: string | null): EngineId[] {
  if (json === null) return ['google_aio']
  try {
    const parsed: unknown = JSON.parse(json)
    const engines = Array.isArray(parsed) ? normaliseEngines(parsed) : []
    return engines.length > 0 ? engines : ['google_aio']
  } catch {
    return ['google_aio']
  }
}

function promptIdsOf(json: string | null): string[] | null {
  if (json === null) return null
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : null
  } catch {
    return null
  }
}

function durationOf(startedAt: string, finishedAt: string | null): number | null {
  if (finishedAt === null) return null
  const ms = Date.parse(finishedAt) - Date.parse(startedAt)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

function subjectOf(page: PageSummary): HistorySubject {
  return {
    id: page.id,
    kind: page.kind === 'topic' ? 'topic' : 'page',
    label: page.label ?? page.title ?? page.url ?? page.id,
    url: page.kind === 'topic' ? null : page.url
  }
}
