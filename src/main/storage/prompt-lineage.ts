import type { SqliteDatabase } from './database'

/** `prompt_lineage` rows (project migration 036) and the prompt version facts they link. */

export interface PromptLineageRow {
  promptId: string
  previousPromptId: string
  pageId: string
  createdAt: string
}

/** One prompt as stored in one prompt-set version. */
export interface StoredPromptVersion {
  promptId: string
  pageId: string
  promptSetId: string
  version: number
  savedAt: string
  active: boolean
  position: number
  texts: { marketId: string; text: string }[]
}

/** Links each new prompt to the prompt it was carried from. Skips ids that are not saved prompts. */
export function insertPromptLineage(db: SqliteDatabase, rows: readonly PromptLineageRow[]): void {
  const insert = db.prepare(
    `INSERT INTO prompt_lineage (prompt_id, previous_prompt_id, page_id, created_at)
     SELECT ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM prompts WHERE id = ?)
        AND EXISTS (SELECT 1 FROM prompts WHERE id = ?)`
  )
  for (const row of rows) {
    if (row.promptId === row.previousPromptId) continue
    insert.run(
      row.promptId,
      row.previousPromptId,
      row.pageId,
      row.createdAt,
      row.promptId,
      row.previousPromptId
    )
  }
}

export function previousPromptId(db: SqliteDatabase, promptId: string): string | null {
  const row = db
    .prepare<unknown[], { previous_prompt_id: string }>(
      'SELECT previous_prompt_id FROM prompt_lineage WHERE prompt_id = ?'
    )
    .get(promptId)
  return row?.previous_prompt_id ?? null
}

/** Prompts carried from this one into later versions. */
export function nextPromptIds(db: SqliteDatabase, promptId: string): string[] {
  return db
    .prepare<unknown[], { prompt_id: string }>(
      'SELECT prompt_id FROM prompt_lineage WHERE previous_prompt_id = ? ORDER BY created_at, rowid'
    )
    .all(promptId)
    .map((row) => row.prompt_id)
}

/** The prompt, its set's version and its wording per market. Null when the prompt is not on the page. */
export function readPromptVersion(
  db: SqliteDatabase,
  pageId: string,
  promptId: string
): StoredPromptVersion | null {
  const row = db
    .prepare<
      unknown[],
      {
        id: string
        position: number
        set_id: string
        version: number
        saved_at: string
        is_active: number
      }
    >(
      `SELECT prompts.id, prompts.position, prompt_sets.id AS set_id, prompt_sets.version,
              prompt_sets.saved_at, prompt_sets.is_active
         FROM prompts JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
        WHERE prompts.id = ? AND prompt_sets.page_id = ?`
    )
    .get(promptId, pageId)
  if (row === undefined) return null
  const texts = db
    .prepare<unknown[], { market_id: string; text: string }>(
      'SELECT market_id, text FROM prompt_variants WHERE prompt_id = ? ORDER BY rowid'
    )
    .all(promptId)
    .map((variant) => ({ marketId: variant.market_id, text: variant.text }))
  return {
    promptId: row.id,
    pageId,
    promptSetId: row.set_id,
    version: row.version,
    savedAt: row.saved_at,
    active: row.is_active === 1,
    position: row.position,
    texts
  }
}
