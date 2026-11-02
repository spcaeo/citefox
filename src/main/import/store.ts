import type { ImportEntity, ImportMapping, ImportStageWords } from '@shared/ipc'
import { isImportEntity } from '@shared/import-fields'
import { TOPIC_STAGES, type TopicStage } from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'

/** `import_batches` and `import_mappings` (project migration 038). */

/** One thing a batch created, so Undo can take it out again. */
export type BatchItem =
  | { kind: 'prompt'; sourceId: string; promptId: string }
  | { kind: 'topic'; topicId: string }
  | { kind: 'competitor'; name: string; domain: string | null }
  | { kind: 'product'; productId: string }
  | { kind: 'market'; marketId: string; pageId: string | null; created: boolean }

export interface ImportBatch {
  id: string
  entity: ImportEntity
  createdAt: string
  items: BatchItem[]
  added: number
  undoneAt: string | null
}

export function insertBatch(db: SqliteDatabase, batch: Omit<ImportBatch, 'undoneAt'>): void {
  db.prepare(
    `INSERT INTO import_batches (id, entity, created_at, items_json, added)
     VALUES (?, ?, ?, ?, ?)`
  ).run(batch.id, batch.entity, batch.createdAt, JSON.stringify(batch.items), batch.added)
}

export function getBatch(db: SqliteDatabase, id: string): ImportBatch | null {
  const row = db
    .prepare<
      unknown[],
      {
        id: string
        entity: string
        created_at: string
        items_json: string
        added: number
        undone_at: string | null
      }
    >('SELECT * FROM import_batches WHERE id = ?')
    .get(id)
  if (row === undefined || !isImportEntity(row.entity)) return null
  return {
    id: row.id,
    entity: row.entity,
    createdAt: row.created_at,
    items: parseItems(row.items_json),
    added: row.added,
    undoneAt: row.undone_at
  }
}

export function markBatchUndone(db: SqliteDatabase, id: string, at: string): void {
  db.prepare('UPDATE import_batches SET undone_at = ? WHERE id = ?').run(at, id)
}

function parseItems(json: string): BatchItem[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as BatchItem[]) : []
  } catch {
    return []
  }
}

export interface SavedMapping {
  mapping: ImportMapping
  stageWords: ImportStageWords
}

export function readMapping(
  db: SqliteDatabase,
  entity: ImportEntity,
  signature: string
): SavedMapping | null {
  const row = db
    .prepare<unknown[], { mapping_json: string; stage_words_json: string }>(
      'SELECT mapping_json, stage_words_json FROM import_mappings WHERE entity = ? AND signature = ?'
    )
    .get(entity, signature)
  if (row === undefined) return null
  try {
    const mapping: unknown = JSON.parse(row.mapping_json)
    const words: unknown = JSON.parse(row.stage_words_json)
    if (!Array.isArray(mapping)) return null
    return {
      mapping: mapping.map((field) => (typeof field === 'string' ? field : null)),
      stageWords: cleanStageWords(words)
    }
  } catch {
    return null
  }
}

/** The stage words saved for any file of this kind: a word means the same in the next file. */
export function readStageWords(db: SqliteDatabase, entity: ImportEntity): ImportStageWords {
  const rows = db
    .prepare<unknown[], { stage_words_json: string }>(
      'SELECT stage_words_json FROM import_mappings WHERE entity = ? ORDER BY updated_at'
    )
    .all(entity)
  const merged: Record<string, TopicStage | null> = {}
  for (const row of rows) {
    try {
      Object.assign(merged, cleanStageWords(JSON.parse(row.stage_words_json)))
    } catch {
      // A broken row only loses its own words.
    }
  }
  return merged
}

export function saveMapping(
  db: SqliteDatabase,
  entity: ImportEntity,
  signature: string,
  saved: SavedMapping,
  at: string
): void {
  db.prepare(
    `INSERT INTO import_mappings (entity, signature, mapping_json, stage_words_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (entity, signature) DO UPDATE SET
       mapping_json = excluded.mapping_json,
       stage_words_json = excluded.stage_words_json,
       updated_at = excluded.updated_at`
  ).run(
    entity,
    signature.slice(0, 4000),
    JSON.stringify(saved.mapping),
    JSON.stringify(cleanStageWords(saved.stageWords)),
    at
  )
}

function cleanStageWords(value: unknown): Record<string, TopicStage | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, TopicStage | null> = {}
  for (const [key, stage] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || key.length > 80) continue
    if (typeof stage === 'string' && (TOPIC_STAGES as readonly string[]).includes(stage)) {
      out[key] = stage as TopicStage
    }
  }
  return out
}
