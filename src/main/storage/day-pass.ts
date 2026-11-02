import { containsSecret } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { requireLocalDate } from './values'

/**
 * SCH-2 and decision 26. The tray and a separate `citefox --check-due` process
 * share this marker, keyed by the local calendar date (`YYYY-MM-DD`).
 * `jobIds` and `pages` are the pass that already ran, so the second process
 * can return the same result. A later set for the same date replaces the row.
 */
export interface DayPassDetail {
  jobIds: readonly string[]
  pages: number
}

export interface DayPassMarker {
  day: string
  jobIds: readonly string[]
  pages: number
}

const EMPTY_PASS: DayPassDetail = { jobIds: [], pages: 0 }

export function getDayPass(db: SqliteDatabase, localDate: string): DayPassMarker | null {
  const day = requireLocalDate(localDate)
  const row = db
    .prepare<unknown[], DayPassSql>(`SELECT day, job_ids, pages FROM day_pass WHERE day = ?`)
    .get(day)
  if (row === undefined) return null
  return {
    day: row.day,
    jobIds: readJobIds(row.job_ids),
    pages: row.pages
  }
}

export function hasDayPass(db: SqliteDatabase, localDate: string): boolean {
  const day = requireLocalDate(localDate)
  const row = db
    .prepare<unknown[], { day: string }>(`SELECT day FROM day_pass WHERE day = ?`)
    .get(day)
  return row !== undefined
}

export function setDayPass(
  db: SqliteDatabase,
  localDate: string,
  detail: DayPassDetail = EMPTY_PASS
): void {
  const day = requireLocalDate(localDate)
  const jobIds = requireJobIds(detail.jobIds)
  const pages = requirePages(detail.pages)
  try {
    db.prepare(
      `INSERT INTO day_pass (day, job_ids, pages) VALUES (?, ?, ?)
       ON CONFLICT (day) DO UPDATE SET job_ids = excluded.job_ids, pages = excluded.pages`
    ).run(day, JSON.stringify(jobIds), pages)
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save day pass')
    throw error
  }
}

interface DayPassSql {
  day: string
  job_ids: string
  pages: number
}

function readJobIds(encoded: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded) as unknown
  } catch {
    throw new StorageError('Invalid day pass')
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new StorageError('Invalid day pass')
  }
  return parsed
}

function requireJobIds(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new StorageError('Invalid day pass')
  const ids: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 4000 || hasControlCharacter(id)) {
      throw new StorageError('Invalid day pass job id')
    }
    if (containsSecret(id)) throw new StorageError('Day pass cannot contain a secret')
    ids.push(id)
  }
  return ids
}

function requirePages(value: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new StorageError('Invalid day pass pages')
  }
  return value
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
