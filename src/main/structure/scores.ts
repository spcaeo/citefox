import { loadPageResults } from '../engine/checks/results'
import type { SqliteDatabase } from '../storage/database'

/**
 * Per-market scores for structure summaries (FR-20.8). Each number is the
 * Results screen's own (`loadPageResults`), so a cluster's average, change,
 * and weakest market match what each page shows (NFR-14). Results are cached
 * by the latest finished run, so a new check is picked up at once.
 */

export interface MarketScore {
  marketId: string
  score: number | null
  change: number | null
}

const cache = new Map<string, MarketScore>()
const MAX_CACHE = 5_000

/** Page id → market id → latest finished run id, in one query. */
export function latestFinishedRuns(db: SqliteDatabase): Map<string, Map<string, string>> {
  const rows = db
    .prepare<unknown[], { page_id: string; market_id: string; id: string }>(
      `SELECT page_id, market_id, id FROM runs
       WHERE status = 'finished' AND google_aio = 1
       ORDER BY started_at ASC, rowid ASC`
    )
    .all()
  const map = new Map<string, Map<string, string>>()
  for (const row of rows) {
    const markets = map.get(row.page_id) ?? new Map<string, string>()
    markets.set(row.market_id, row.id)
    map.set(row.page_id, markets)
  }
  return map
}

export function marketScores(
  db: SqliteDatabase,
  input: {
    projectId: string
    domain: string
    pageId: string
    runs: ReadonlyMap<string, string> | undefined
    builtAt: string
  }
): MarketScore[] {
  if (input.runs === undefined) return []
  const scores: MarketScore[] = []
  for (const [marketId, runId] of input.runs) {
    const key = `${input.projectId}|${input.pageId}|${marketId}|${runId}`
    let entry = cache.get(key)
    if (entry === undefined) {
      try {
        const results = loadPageResults(db, {
          projectId: input.projectId,
          pageId: input.pageId,
          marketId,
          runId: null,
          builtAt: input.builtAt,
          domain: input.domain,
          keyLabels: new Map()
        })
        entry = {
          marketId,
          score: results.run?.visibilityScore ?? null,
          change: results.scoreChange.sincePrevious
        }
      } catch {
        entry = { marketId, score: null, change: null }
      }
      if (cache.size >= MAX_CACHE) cache.clear()
      cache.set(key, entry)
    }
    scores.push(entry)
  }
  return scores
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}
