import {
  readStoredOverviewRead,
  type OverviewRead,
  type StoredOverviewRead
} from '@shared/overview-read'
import type { SqliteDatabase } from './database'
import { requireUtcTimestamp, runWrite } from './record-values'
import { assertId } from './values'

/**
 * `overview_reads` in the project database (project migration 035): the saved
 * "Analyse with Claude" read per overview sample, so reopening the prompt page shows
 * it without asking Claude again. A row whose JSON no longer reads is left out.
 */

/** Ids per `IN (...)` query, well under SQLite's bound-parameter limit. */
const ID_CHUNK = 500

interface OverviewReadSql {
  serp_result_id: string
  read_json: string
  ran_at: string
}

/** Saves the read of one sample, replacing an earlier one. */
export function saveOverviewRead(
  db: SqliteDatabase,
  record: { sampleId: string; ranAt: string; read: OverviewRead }
): void {
  const sampleId = assertId(record.sampleId)
  const ranAt = requireUtcTimestamp(record.ranAt)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT OR REPLACE INTO overview_reads (serp_result_id, read_json, ran_at)
           VALUES (?, ?, ?)`
        )
        .run(sampleId, JSON.stringify(record.read), ranAt),
    'Could not save the overview read'
  )
}

/** Saved reads for these samples, in the order given. A sample with none is absent. */
export function listOverviewReads(
  db: SqliteDatabase,
  sampleIds: readonly string[]
): StoredOverviewRead[] {
  const unique = [...new Set(sampleIds.map((id) => assertId(id)))]
  const found = new Map<string, StoredOverviewRead>()
  for (let start = 0; start < unique.length; start += ID_CHUNK) {
    const chunk = unique.slice(start, start + ID_CHUNK)
    const rows = db
      .prepare<unknown[], OverviewReadSql>(
        `SELECT serp_result_id, read_json, ran_at FROM overview_reads
         WHERE serp_result_id IN (${chunk.map(() => '?').join(', ')})`
      )
      .all(...chunk)
    for (const row of rows) {
      const read = readStoredOverviewRead(parseJson(row.read_json))
      if (read !== null) {
        found.set(row.serp_result_id, { sampleId: row.serp_result_id, ranAt: row.ran_at, read })
      }
    }
  }
  return unique.flatMap((id) => {
    const read = found.get(id)
    return read === undefined ? [] : [read]
  })
}

function parseJson(encoded: string): unknown {
  try {
    return JSON.parse(encoded) as unknown
  } catch {
    return null
  }
}
