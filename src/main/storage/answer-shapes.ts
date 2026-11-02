import { ANSWER_SHAPE_EXCERPT_MAX } from '../analytics/answer-shape/schema'
import {
  isAnswerShapeCode,
  type AnswerShapeBlock,
  type StoredAnswerShape
} from '../analytics/answer-shape/vocabulary'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { requireUtcTimestamp, runWrite } from './record-values'
import { readJson, requireContentHash } from './values'

/**
 * `answer_shapes` in the project database (Docs/REPORT-SPEC.md section 9): one
 * classification per overview text, keyed by `overviewHash`. A block with a code
 * outside the fixed vocabulary is dropped on read, never shown.
 */

/** Hashes per `IN (...)` query, well under SQLite's bound-parameter limit. */
const HASH_CHUNK = 500

interface AnswerShapeSql {
  overview_hash: string
  template_hash: string
  blocks_json: string
  classified_at: string
}

/** Insert one classification, replacing an earlier one for the same overview. */
export function saveAnswerShape(db: SqliteDatabase, record: StoredAnswerShape): void {
  const overviewHash = requireContentHash(record.overviewHash)
  const templateHash = requireContentHash(record.templateHash)
  const classifiedAt = requireUtcTimestamp(record.classifiedAt)
  const blocks = record.blocks.map(requireBlock)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT OR REPLACE INTO answer_shapes (
             overview_hash, template_hash, blocks_json, classified_at
           ) VALUES (?, ?, ?, ?)`
        )
        .run(overviewHash, templateHash, JSON.stringify(blocks), classifiedAt),
    'Could not save answer shape'
  )
}

/** Stored classifications for these overview hashes. A hash with no row is absent. */
export function getAnswerShapes(
  db: SqliteDatabase,
  hashes: readonly string[]
): Map<string, StoredAnswerShape> {
  const found = new Map<string, StoredAnswerShape>()
  const unique = [...new Set(hashes.map((hash) => requireContentHash(hash)))]
  for (let start = 0; start < unique.length; start += HASH_CHUNK) {
    const chunk = unique.slice(start, start + HASH_CHUNK)
    const rows = db
      .prepare<unknown[], AnswerShapeSql>(
        `SELECT overview_hash, template_hash, blocks_json, classified_at FROM answer_shapes
         WHERE overview_hash IN (${chunk.map(() => '?').join(', ')})`
      )
      .all(...chunk)
    for (const row of rows) found.set(row.overview_hash, fromSql(row))
  }
  return found
}

/** Every cached overview hash, sorted. */
export function listAnswerShapeHashes(db: SqliteDatabase): string[] {
  return db
    .prepare<unknown[], { overview_hash: string }>(
      'SELECT overview_hash FROM answer_shapes ORDER BY overview_hash ASC'
    )
    .all()
    .map((row) => row.overview_hash)
}

function requireBlock(block: AnswerShapeBlock): AnswerShapeBlock {
  if (!isAnswerShapeCode(block.code)) throw new StorageError('Invalid answer shape code')
  const excerpt = block.excerpt.trim()
  if (excerpt.length === 0 || excerpt.length > ANSWER_SHAPE_EXCERPT_MAX) {
    throw new StorageError('Invalid answer shape excerpt')
  }
  return { code: block.code, excerpt }
}

function fromSql(row: AnswerShapeSql): StoredAnswerShape {
  return {
    overviewHash: row.overview_hash,
    templateHash: row.template_hash,
    blocks: readBlocks(row.blocks_json),
    classifiedAt: row.classified_at
  }
}

function readBlocks(encoded: string): AnswerShapeBlock[] {
  const parsed = readJson(encoded, 'answer shape blocks')
  if (!Array.isArray(parsed)) return []
  const blocks: AnswerShapeBlock[] = []
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { code, excerpt } = item as { code?: unknown; excerpt?: unknown }
    if (typeof code !== 'string' || !isAnswerShapeCode(code)) continue
    blocks.push({ code, excerpt: typeof excerpt === 'string' ? excerpt : '' })
  }
  return blocks
}
