import type { PageBlock, PageBlockKind, PageEditChange, PageEditResult } from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireStoredText, requireUtcTimestamp } from './values'

/**
 * Saved page edits in the project database (project migration 052): the last
 * page-with-edits CiteFox AI wrote for each page fix of What to fix, shown again
 * when its Page edits tab opens. A new one for the same fix replaces it.
 */

export const PAGE_BLOCK_KINDS: readonly PageBlockKind[] = [
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'li',
  'quote',
  'code',
  'table'
]
const BLOCKS_MAX = 260
const CHANGES_MAX = 20
const TEXT_MAX = 4000
const LINE_MAX = 600
const URL_MAX = 2000
const ID_MAX = 20

interface EditSql {
  fix_id: string
  edit_json: string
  saved_at: string
}

/** The saved edits, checked field by field. Null when anything is off. */
export function toPageEdit(value: unknown): PageEditResult | null {
  if (!isRecord(value)) return null
  const { fixId, url, title, readAt, blocks, changes, summary, note, savedAt } = value
  if (!isText(fixId, 80) || !isText(url, URL_MAX) || !isText(readAt, 40)) return null
  if (title !== null && !isText(title, LINE_MAX)) return null
  if (!isText(summary, LINE_MAX) || !isText(note, 200) || !isText(savedAt, 40)) return null
  if (!Array.isArray(blocks) || blocks.length > BLOCKS_MAX) return null
  if (!Array.isArray(changes) || changes.length > CHANGES_MAX) return null
  const pageBlocks: PageBlock[] = []
  for (const block of blocks as unknown[]) {
    const read = toBlock(block)
    if (read === null) return null
    pageBlocks.push(read)
  }
  const ids = new Set(pageBlocks.map((block) => block.id))
  const edits: PageEditChange[] = []
  for (const change of changes as unknown[]) {
    const read = toChange(change, ids)
    if (read === null) return null
    edits.push(read)
  }
  return {
    fixId,
    url,
    title: title as string | null,
    readAt,
    blocks: pageBlocks,
    changes: edits,
    summary,
    note,
    savedAt
  }
}

function toBlock(value: unknown): PageBlock | null {
  if (!isRecord(value)) return null
  const { id, kind, text } = value
  if (!isText(id, ID_MAX) || !isKind(kind) || !isText(text, TEXT_MAX)) return null
  return { id, kind, text }
}

/** One change whose block ids are among the page's blocks. */
export function toChange(value: unknown, ids: ReadonlySet<string>): PageEditChange | null {
  if (!isRecord(value)) return null
  const { id, op, why } = value
  if (!isText(id, ID_MAX) || !isText(why, LINE_MAX)) return null
  if (op === 'delete') {
    const { block } = value
    if (typeof block !== 'string' || !ids.has(block)) return null
    return { id, op, block, why }
  }
  const { kind, text } = value
  if (!isKind(kind) || !isText(text, TEXT_MAX)) return null
  if (op === 'replace') {
    const { block } = value
    if (typeof block !== 'string' || !ids.has(block)) return null
    return { id, op, block, kind, text, why }
  }
  if (op === 'insert') {
    const { after } = value
    if (after !== null && (typeof after !== 'string' || !ids.has(after))) return null
    return { id, op, after, kind, text, why }
  }
  return null
}

/** The fix's saved edits, or null. A row that no longer reads as edits is null too. */
export function getPageEdit(db: SqliteDatabase, fixId: string): PageEditResult | null {
  const row = db
    .prepare<[string], EditSql>(
      'SELECT fix_id, edit_json, saved_at FROM page_edits WHERE fix_id = ?'
    )
    .get(assertId(fixId))
  if (row === undefined) return null
  return toPageEdit(parseJson(row.edit_json))
}

/** Saves the fix's edits, replacing the ones before. */
export function putPageEdit(db: SqliteDatabase, edit: PageEditResult): PageEditResult {
  const fixId = assertId(edit.fixId)
  const checked = toPageEdit(edit)
  if (checked === null) throw new StorageError('Invalid page edits')
  const json = requireStoredText(JSON.stringify(checked), 'page edits', 1_000_000)
  const savedAt = requireUtcTimestamp(checked.savedAt)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO page_edits (fix_id, edit_json, saved_at) VALUES (?, ?, ?)
           ON CONFLICT (fix_id) DO UPDATE SET
             edit_json = excluded.edit_json,
             saved_at = excluded.saved_at`
        )
        .run(fixId, json, savedAt),
    'Save page edits'
  )
  return checked
}

function isKind(value: unknown): value is PageBlockKind {
  return typeof value === 'string' && (PAGE_BLOCK_KINDS as readonly string[]).includes(value)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
