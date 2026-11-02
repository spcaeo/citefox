import type { SqliteDatabase } from './database'
import { StorageError } from './errors'

/**
 * Month-to-date `key_usage` for the caps ledger (decision 26, SERP-6, FR-11.4).
 * One stored row is one key, one project, and one `YYYY-MM`.
 * `projectId` is null when the row is not tied to a project. This read sums
 * those rows per key and across every key, including the rows with no project.
 *
 * The single-row reader stays `getKeyUsage(db, id)` in `records.ts`.
 * This name is separate so a month cannot be mistaken for a row id.
 */
export interface KeyUsageProjectMonth {
  /** Null when the usage is not tied to a project. */
  projectId: string | null
  searches: number
  calls: number
  tokens: number
}

export interface KeyUsageKeyMonth {
  keyId: string
  searches: number
  calls: number
  tokens: number
  projects: readonly KeyUsageProjectMonth[]
}

export interface MonthKeyUsage {
  month: string
  keys: readonly KeyUsageKeyMonth[]
  totals: {
    searches: number
    calls: number
    tokens: number
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export function getKeyUsageForMonth(db: SqliteDatabase, month: string): MonthKeyUsage {
  const key = requireMonth(month)
  const rows = db
    .prepare<unknown[], UsageSql>(
      `SELECT key_id, project_id, searches, calls, tokens
       FROM key_usage
       WHERE month = ?
       ORDER BY key_id ASC, project_id ASC`
    )
    .all(key)
  const keys: MutableKeyMonth[] = []
  const totals = { searches: 0, calls: 0, tokens: 0 }
  for (const row of rows) {
    const project: KeyUsageProjectMonth = {
      projectId: row.project_id,
      searches: row.searches,
      calls: row.calls,
      tokens: row.tokens
    }
    totals.searches += project.searches
    totals.calls += project.calls
    totals.tokens += project.tokens
    const current = keys[keys.length - 1]
    if (current !== undefined && current.keyId === row.key_id) {
      current.projects.push(project)
      current.searches += project.searches
      current.calls += project.calls
      current.tokens += project.tokens
      continue
    }
    keys.push({
      keyId: row.key_id,
      searches: project.searches,
      calls: project.calls,
      tokens: project.tokens,
      projects: [project]
    })
  }
  return { month: key, keys, totals }
}

interface MutableKeyMonth {
  keyId: string
  searches: number
  calls: number
  tokens: number
  projects: KeyUsageProjectMonth[]
}

interface UsageSql {
  key_id: string
  project_id: string | null
  searches: number
  calls: number
  tokens: number
}

function requireMonth(value: string): string {
  if (typeof value !== 'string' || !MONTH.test(value)) throw new StorageError('Invalid usage month')
  return value
}

/**
 * Each key with CiteFox's own searches this month (`usedThisMonth`), so a CiteFox
 * cap is measured against CiteFox's count and not the whole SerpApi account's.
 */
export function withCountedSearches<T extends { id: string }>(
  db: SqliteDatabase,
  records: readonly T[],
  month: string
): (T & { usedThisMonth: number })[] {
  const used = new Map(getKeyUsageForMonth(db, month).keys.map((key) => [key.keyId, key.searches]))
  return records.map((record) => ({ ...record, usedThisMonth: used.get(record.id) ?? 0 }))
}

/** Searches and cloro credits per search provider in one month, across every project. */
export function sumProviderUsageForMonth(
  db: SqliteDatabase,
  month: string
): { provider: 'serpapi' | 'cloro'; searches: number; credits: number }[] {
  const key = requireMonth(month)
  return db
    .prepare<unknown[], { provider: 'serpapi' | 'cloro'; searches: number; credits: number }>(
      `SELECT api_keys.provider AS provider, SUM(key_usage.searches) AS searches,
              SUM(key_usage.credits) AS credits
       FROM key_usage JOIN api_keys ON api_keys.id = key_usage.key_id
       WHERE key_usage.month = ? AND api_keys.provider IN ('serpapi', 'cloro')
       GROUP BY api_keys.provider
       ORDER BY api_keys.provider ASC`
    )
    .all(key)
}
