import type { PageFixBriefContent, PageFixBriefItem, SavedPageFixBrief } from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireStoredText, requireUtcTimestamp } from './values'

/**
 * Saved page fix briefs in the project database (project migration 051): the last
 * brief CiteFox AI wrote for each page fix of What to fix. A saved brief makes the
 * fix's Status "Brief ready" and shows again when its drawer opens.
 */

const TITLE_MAX = 120
const LINE_MAX = 4000
const TEXT_MAX = 12000
const NOTE_MAX = 200
const URL_MAX = 2000
const ITEMS_MAX = 40
const ITEM_ID_MAX = 80

interface BriefSql {
  fix_id: string
  brief_json: string
  saved_at: string
}

/**
 * The brief, checked field by field (exact keys, bounded lengths, an https link
 * only). Null when anything is off, so a bad request or a damaged row is refused
 * instead of shown.
 */
export function toBriefContent(value: unknown): PageFixBriefContent | null {
  if (!isRecord(value)) return null
  const keys = ['title', 'summary', 'items', 'text', 'writeWithUrl', 'note']
  if (!sameKeys(value, keys)) return null
  const { title, summary, items, text, writeWithUrl, note } = value
  if (!isText(title, TITLE_MAX) || !isText(note, NOTE_MAX)) return null
  if (text !== '' && !isText(text, TEXT_MAX)) return null
  if (summary !== null && summary !== '' && !isText(summary, LINE_MAX)) return null
  if (writeWithUrl !== null && !isHttpsUrl(writeWithUrl)) return null
  if (!Array.isArray(items) || items.length > ITEMS_MAX) return null
  const lines: PageFixBriefItem[] = []
  for (const item of items as unknown[]) {
    const line = toItem(item)
    if (line === null) return null
    lines.push(line)
  }
  return {
    title,
    summary: summary === '' ? null : (summary as string | null),
    items: lines,
    text: text as string,
    writeWithUrl: writeWithUrl as string | null,
    note
  }
}

function toItem(value: unknown): PageFixBriefItem | null {
  if (!isRecord(value)) return null
  const allowed = ['id', 'label', 'text', 'detail']
  if (!Object.keys(value).every((key) => allowed.includes(key))) return null
  const { id, label, text, detail } = value
  if (!isText(id, ITEM_ID_MAX) || !isText(text, LINE_MAX)) return null
  if (label !== undefined && label !== '' && !isText(label, TITLE_MAX)) return null
  if (detail !== undefined && detail !== null && detail !== '' && !isText(detail, LINE_MAX)) {
    return null
  }
  return {
    id,
    ...(isText(label, TITLE_MAX) ? { label } : {}),
    text,
    ...(detail !== undefined ? { detail: detail === '' ? null : (detail as string | null) } : {})
  }
}

/** Every saved brief, newest first. A row that no longer reads as a brief is left out. */
export function listPageFixBriefs(db: SqliteDatabase): SavedPageFixBrief[] {
  return db
    .prepare<unknown[], BriefSql>(
      `SELECT fix_id, brief_json, saved_at FROM page_fix_briefs
       ORDER BY saved_at DESC, fix_id ASC`
    )
    .all()
    .flatMap((row) => {
      const brief = toBriefContent(parseJson(row.brief_json))
      return brief === null ? [] : [{ fixId: row.fix_id, brief, savedAt: row.saved_at }]
    })
}

/** Saves the fix's brief, replacing the one before. */
export function putPageFixBrief(db: SqliteDatabase, record: SavedPageFixBrief): SavedPageFixBrief {
  const fixId = assertId(record.fixId)
  const brief = toBriefContent(record.brief)
  if (brief === null) throw new StorageError('Invalid brief')
  const json = requireStoredText(JSON.stringify(brief), 'brief', 40000)
  const savedAt = requireUtcTimestamp(record.savedAt)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO page_fix_briefs (fix_id, brief_json, saved_at) VALUES (?, ?, ?)
           ON CONFLICT (fix_id) DO UPDATE SET
             brief_json = excluded.brief_json,
             saved_at = excluded.saved_at`
        )
        .run(fixId, json, savedAt),
    'Save brief'
  )
  return { fixId, brief, savedAt }
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

function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  return present.length === keys.length && keys.every((key) => present.includes(key))
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > URL_MAX) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
