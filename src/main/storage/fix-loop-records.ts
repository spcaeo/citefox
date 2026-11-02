import {
  DEFAULT_LOOP_OWNERS,
  isLoopStep,
  LOOP_STEPS,
  OWNER_LABEL_MAX,
  type IndexState,
  type LoopStep
} from '@shared/fix-loop'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireLabel, requireStoredText, requireUtcTimestamp } from './values'

/**
 * Fix → measure → repeat in the project database (project migration 043):
 * `loop_owners` (who does each step of a round), `index_checks` (each "Check index"
 * of a page; the newest row is its state) and `page_ai_texts` (Claude text cached per
 * page: the backlink anchor and the Lost ground recovery plan). Nothing here is
 * derived from checks; the ledger reads stored runs for that.
 */

const INDEX_STATES: readonly IndexState[] = ['indexed', 'not_indexed', 'unknown']
const MESSAGE_MAX = 500
const URL_MAX = 2000
const INPUT_KEY_MAX = 200
/** Longest cached Claude text, the `page_ai_texts.text` bound. */
export const PAGE_AI_TEXT_MAX = 8000

/** The owner of every step: the renamed label, else the default. */
export function readLoopOwners(db: SqliteDatabase): Record<LoopStep, string> {
  const owners: Record<LoopStep, string> = { ...DEFAULT_LOOP_OWNERS }
  const rows = db
    .prepare<unknown[], { step: string; label: string }>(`SELECT step, label FROM loop_owners`)
    .all()
  for (const row of rows) if (isLoopStep(row.step)) owners[row.step] = row.label
  return owners
}

/**
 * Renames a step's owner. The label is trimmed; an empty label (or the default
 * itself) removes the row, so the step reads as its default again.
 */
export function setLoopOwner(
  db: SqliteDatabase,
  step: LoopStep,
  label: string
): Record<LoopStep, string> {
  if (!LOOP_STEPS.includes(step)) throw new StorageError('Invalid loop step')
  const trimmed = typeof label === 'string' ? label.trim() : ''
  if (trimmed.length === 0 || trimmed === DEFAULT_LOOP_OWNERS[step]) {
    runWrite(
      () => db.prepare(`DELETE FROM loop_owners WHERE step = ?`).run(step),
      'Could not save the owner'
    )
    return readLoopOwners(db)
  }
  const stored = requireLabel(trimmed, 'owner', OWNER_LABEL_MAX)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO loop_owners (step, label) VALUES (?, ?)
           ON CONFLICT (step) DO UPDATE SET label = excluded.label`
        )
        .run(step, stored),
    'Could not save the owner'
  )
  return readLoopOwners(db)
}

export interface IndexCheckRecord {
  id: string
  pageId: string
  /** The address that was checked. */
  url: string
  state: IndexState
  /** ISO-8601 UTC. */
  checkedAt: string
  /** SerpApi searches the check used. */
  searches: number
  /** Why the check could not tell (`unknown`). */
  message: string | null
}

export function insertIndexCheck(db: SqliteDatabase, record: IndexCheckRecord): void {
  const id = assertId(record.id)
  const pageId = assertId(record.pageId)
  const url = requireStoredText(record.url, 'checked address', URL_MAX)
  if (!INDEX_STATES.includes(record.state)) throw new StorageError('Invalid index state')
  const checkedAt = requireUtcTimestamp(record.checkedAt)
  if (!Number.isInteger(record.searches) || record.searches < 0) {
    throw new StorageError('Invalid search count')
  }
  const message =
    record.message === null
      ? null
      : requireStoredText(record.message.slice(0, MESSAGE_MAX), 'index message', MESSAGE_MAX)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO index_checks (id, page_id, url, state, checked_at, searches, message)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, pageId, url, record.state, checkedAt, record.searches, message),
    'Could not save the index check'
  )
}

/** The newest index check of every page that has one, by page id. */
export function latestIndexChecks(db: SqliteDatabase): Map<string, IndexCheckRecord> {
  const rows = db
    .prepare<unknown[], IndexCheckSql>(
      `SELECT id, page_id, url, state, checked_at, searches, message
       FROM index_checks ORDER BY checked_at ASC, rowid ASC`
    )
    .all()
  const latest = new Map<string, IndexCheckRecord>()
  for (const row of rows) {
    const record = indexCheckFromSql(row)
    if (record !== null) latest.set(record.pageId, record)
  }
  return latest
}

export type PageAiTextKind = 'anchor' | 'recovery'

export interface PageAiText {
  pageId: string
  kind: PageAiTextKind
  /** What the text was written for (a plan: `<vsRunId>|<nowRunId>`). */
  inputKey: string
  text: string
  /** True once the person changed it. */
  edited: boolean
  /** ISO-8601 UTC. */
  savedAt: string
}

export function getPageAiText(
  db: SqliteDatabase,
  pageId: string,
  kind: PageAiTextKind
): PageAiText | null {
  const row = db
    .prepare<unknown[], PageAiTextSql>(
      `SELECT page_id, kind, input_key, text, edited, saved_at
       FROM page_ai_texts WHERE page_id = ? AND kind = ?`
    )
    .get(assertId(pageId), requireKind(kind))
  return row === undefined ? null : aiTextFromSql(row)
}

/** Every cached text of one kind, by page id order. */
export function listPageAiTexts(db: SqliteDatabase, kind: PageAiTextKind): PageAiText[] {
  return db
    .prepare<unknown[], PageAiTextSql>(
      `SELECT page_id, kind, input_key, text, edited, saved_at
       FROM page_ai_texts WHERE kind = ? ORDER BY page_id ASC`
    )
    .all(requireKind(kind))
    .map(aiTextFromSql)
}

/** Saves the page's text of this kind, replacing the one before. */
export function putPageAiText(db: SqliteDatabase, record: PageAiText): PageAiText {
  const pageId = assertId(record.pageId)
  const kind = requireKind(record.kind)
  const inputKey = requireStoredText(record.inputKey, 'input key', INPUT_KEY_MAX)
  const text = requireStoredText(record.text.trim(), 'saved text', PAGE_AI_TEXT_MAX)
  const savedAt = requireUtcTimestamp(record.savedAt)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO page_ai_texts (page_id, kind, input_key, text, edited, saved_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (page_id, kind) DO UPDATE SET
             input_key = excluded.input_key,
             text = excluded.text,
             edited = excluded.edited,
             saved_at = excluded.saved_at`
        )
        .run(pageId, kind, inputKey, text, record.edited ? 1 : 0, savedAt),
    'Could not save the text'
  )
  return { pageId, kind, inputKey, text, edited: record.edited, savedAt }
}

/** A page read's id, date and title, oldest first (Lost ground picks two of them). */
export interface SnapshotStamp {
  id: string
  fetchedAt: string
  title: string | null
}

export function listSnapshotStamps(db: SqliteDatabase, pageId: string): SnapshotStamp[] {
  return db
    .prepare<unknown[], { id: string; fetched_at: string; title: string | null }>(
      `SELECT id, fetched_at, title FROM snapshots WHERE page_id = ?
       ORDER BY fetched_at ASC, rowid ASC`
    )
    .all(assertId(pageId))
    .map((row) => ({ id: row.id, fetchedAt: row.fetched_at, title: row.title }))
}

interface IndexCheckSql {
  id: string
  page_id: string
  url: string
  state: string
  checked_at: string
  searches: number
  message: string | null
}

interface PageAiTextSql {
  page_id: string
  kind: string
  input_key: string
  text: string
  edited: number
  saved_at: string
}

function indexCheckFromSql(row: IndexCheckSql): IndexCheckRecord | null {
  const state = INDEX_STATES.find((item) => item === row.state)
  if (state === undefined) return null
  return {
    id: row.id,
    pageId: row.page_id,
    url: row.url,
    state,
    checkedAt: row.checked_at,
    searches: row.searches,
    message: row.message
  }
}

function aiTextFromSql(row: PageAiTextSql): PageAiText {
  return {
    pageId: row.page_id,
    kind: requireKind(row.kind),
    inputKey: row.input_key,
    text: row.text,
    edited: row.edited === 1,
    savedAt: row.saved_at
  }
}

function requireKind(value: string): PageAiTextKind {
  if (value !== 'anchor' && value !== 'recovery') throw new StorageError('Invalid text kind')
  return value
}
