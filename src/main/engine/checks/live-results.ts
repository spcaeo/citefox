import type { CheckJob, CheckMix, CitationNews, ResultsChanged } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import { saveJobSpend } from '../../storage/engine-records'
import { emptyCapture } from './key-rotation'
import { rememberStep, type ProgressDeps } from './job-progress'
import { citationNews } from './citation-news'
import { keywordIds } from './live-runs'
import type { PagePlan, PromptPlan } from './plan'
import type { Prepared } from './prepare'

/**
 * The engine's side of live results (see `live-runs.ts` for the readers): a stored
 * "searching" step before each question, the job's spend kept current in
 * `check_jobs` after each one, and a `results:changed` push per saved result and
 * once at the end, so screens re-read while the check runs.
 */
export interface LiveDeps extends ProgressDeps {
  /** Pushes `results:changed`. Optional: headless runs and most tests have no window. */
  emitResultsChanged?: (event: ResultsChanged) => void
}

/** The job's questions and keywords, each counted once per market it is checked in. */
export function jobMix(db: SqliteDatabase, plan: readonly PagePlan[]): CheckMix {
  let questions = 0
  let keywords = 0
  for (const page of plan) {
    const kws = keywordIds(
      db,
      page.prompts.map((prompt) => prompt.id)
    )
    const perMarket = page.prompts.filter((prompt) => kws.has(prompt.id)).length
    keywords += perMarket * page.markets.length
    questions += (page.prompts.length - perMarket) * page.markets.length
  }
  return { questions, keywords }
}

/** Stored and pushed before a question is searched, so the Check window names it. */
export function markSearching(
  deps: ProgressDeps,
  db: SqliteDatabase,
  job: CheckJob,
  page: PagePlan,
  marketId: string,
  prompt: PromptPlan,
  sampleNo: number,
  engine: string
): void {
  rememberStep(
    deps,
    db,
    job,
    page,
    marketId,
    prompt,
    sampleNo,
    'search',
    'running',
    `Searching ${engine}`,
    emptyCapture(),
    0
  )
}

/**
 * After one question is scored, or as soon as its Google answer lands while its slower
 * answer engines still run: write the searches and credits used so far to the job (they
 * used to land only at the end), then tell the screens. `announced` is the news an
 * earlier push for this question already carried, so a citation celebrates once.
 * Returns the question's news so far (null when no window listens).
 */
export function questionSaved(
  deps: LiveDeps,
  db: SqliteDatabase,
  prepared: Prepared,
  pageId: string,
  marketId: string,
  promptId: string,
  announced: CitationNews | null = null
): CitationNews | null {
  const job = prepared.job
  storeSpendSoFar(db, prepared)
  // Read only when a window listens.
  if (deps.emitResultsChanged === undefined) return null
  // Only the user's own site: a confetti burst when it is cited, a quiet note when named.
  const news = citationNews(db, {
    jobId: job.id,
    pageId,
    marketId,
    promptId,
    brand: prepared.brands[0] ?? prepared.domain
  })
  deps.emitResultsChanged({
    projectId: job.projectId,
    jobId: job.id,
    pageId,
    marketId,
    promptId,
    state: 'running',
    done: job.done,
    total: job.total,
    citation: newsToTell(news, announced)
  })
  return news
}

/** News not yet told: a citation once, a mention only while nothing was told. */
function newsToTell(
  news: CitationNews | null,
  announced: CitationNews | null
): CitationNews | null {
  if (news === null || announced === null) return news
  if (announced.kind === 'cited') return null
  return news.kind === 'cited' ? news : null
}

/** The searches and credits a running job has used, on its `check_jobs` row and in memory. */
export function storeSpendSoFar(db: SqliteDatabase, prepared: Prepared): void {
  const job = prepared.job
  db.prepare('UPDATE check_jobs SET searches_used = ? WHERE id = ?').run(job.searchesUsed, job.id)
  const spend = saveJobSpend(db, job.id, job.provider ?? null)
  job.creditsUsed = spend.credits
  job.costMicros = spend.costMicros
}

/** Once per page when the job ends, however it ended, so screens drop "Checking…". */
export function jobEnded(deps: LiveDeps, job: CheckJob): void {
  if (deps.emitResultsChanged === undefined) return
  const state = job.status === 'finished' ? 'finished' : 'stopped'
  for (const pageId of job.pageIds) {
    deps.emitResultsChanged({
      projectId: job.projectId,
      jobId: job.id,
      pageId,
      marketId: null,
      promptId: null,
      state,
      done: job.done,
      total: job.total
    })
  }
}
