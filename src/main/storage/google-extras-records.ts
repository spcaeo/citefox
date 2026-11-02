import type { SqliteDatabase } from './database'
import { assertId } from './values'

/** `serp_results.google_json` (migration 044): the stored search's organic top 10 and "People also ask". */

/** SQLite's bound-parameter limit is far above this; it keeps each statement small. */
const CHUNK = 400

export interface GoogleJsonRow {
  id: string
  /** Null until the row has been read (rows stored before migration 044). */
  googleJson: string | null
}

/** `google_json` of each sample id that exists. */
export function listGoogleJson(db: SqliteDatabase, ids: readonly string[]): GoogleJsonRow[] {
  return chunked(ids, (part) =>
    db
      .prepare<unknown[], { id: string; google_json: string | null }>(
        `SELECT id, google_json FROM serp_results WHERE id IN (${marks(part.length)})`
      )
      .all(...part)
      .map((row) => ({ id: row.id, googleJson: row.google_json }))
  )
}

/** The stored search body of the samples not read yet, for the one-time back-fill. */
export function listUnreadSearchBodies(
  db: SqliteDatabase,
  ids: readonly string[]
): { id: string; rawSearchJson: string | null }[] {
  return chunked(ids, (part) =>
    db
      .prepare<unknown[], { id: string; raw_search_json: string | null }>(
        `SELECT id, raw_search_json FROM serp_results
         WHERE google_json IS NULL AND id IN (${marks(part.length)})`
      )
      .all(...part)
      .map((row) => ({ id: row.id, rawSearchJson: row.raw_search_json }))
  )
}

/** Writes the read extras in one transaction. A row read meanwhile keeps its value. */
export function saveGoogleJson(
  db: SqliteDatabase,
  rows: readonly { id: string; googleJson: string }[]
): void {
  if (rows.length === 0) return
  const update = db.prepare(
    'UPDATE serp_results SET google_json = ? WHERE id = ? AND google_json IS NULL'
  )
  db.transaction(() => {
    for (const row of rows) update.run(row.googleJson, assertId(row.id))
  })()
}

/** The samples of these runs, optionally for one prompt. */
export function listSampleIds(
  db: SqliteDatabase,
  runIds: readonly string[],
  promptId: string | null
): string[] {
  return chunked(runIds, (part) => {
    const byPrompt = promptId === null ? '' : ' AND prompt_id = ?'
    const args = promptId === null ? part : [...part, assertId(promptId)]
    return db
      .prepare<unknown[], { id: string }>(
        `SELECT id FROM serp_results WHERE run_id IN (${marks(part.length)})${byPrompt}
         ORDER BY run_id, prompt_id, sample_no`
      )
      .all(...args)
      .map((row) => row.id)
  })
}

/** Every wording of every question in an active set, any page or topic, any market. */
export function listTrackedQuestionTexts(db: SqliteDatabase): string[] {
  return db
    .prepare<unknown[], { text: string }>(
      `SELECT prompt_variants.text AS text
       FROM prompt_variants
       JOIN prompts ON prompts.id = prompt_variants.prompt_id
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
       WHERE prompt_sets.is_active = 1`
    )
    .all()
    .map((row) => row.text)
}

function chunked<T>(ids: readonly string[], read: (part: string[]) => T[]): T[] {
  const found: T[] = []
  for (let start = 0; start < ids.length; start += CHUNK) {
    found.push(...read(ids.slice(start, start + CHUNK).map((id) => assertId(id))))
  }
  return found
}

function marks(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
