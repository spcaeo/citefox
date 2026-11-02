import type { PageNote } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, requireLocalDate, requireStoredText, requireUtcTimestamp } from './values'

/**
 * FR-7.4, FR-15.3. Section 10 `notes` in the project database (migration 016).
 * `date` is the local calendar day the user picked, not an instant.
 * Text is the user's own words, trimmed, 1–4000 characters.
 */

export const NOTE_TEXT_MAX = 4000

export interface NewNote {
  id: string
  pageId: string
  date: string
  text: string
  /** ISO-8601 UTC. Also the first `updatedAt`. */
  at: string
}

export function insertNote(db: SqliteDatabase, input: NewNote): PageNote {
  const id = assertId(input.id)
  const pageId = assertId(input.pageId)
  const date = requireLocalDate(input.date)
  const text = requireNoteText(input.text)
  const at = requireUtcTimestamp(input.at)
  requirePage(db, pageId)
  try {
    db.prepare(
      `INSERT INTO notes (id, page_id, date, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, pageId, date, text, at, at)
  } catch (error) {
    if (isSqliteError(error)) {
      if (error.message.includes('UNIQUE') || error.message.includes('PRIMARY KEY')) {
        throw new StorageError('A note with this id already exists')
      }
      throw new StorageError('Could not save the note')
    }
    throw error
  }
  return requireNote(db, id)
}

export function updateNote(
  db: SqliteDatabase,
  id: string,
  change: { date: string; text: string; at: string }
): PageNote {
  const noteId = assertId(id)
  requireNote(db, noteId)
  const date = requireLocalDate(change.date)
  const text = requireNoteText(change.text)
  const at = requireUtcTimestamp(change.at)
  try {
    db.prepare(`UPDATE notes SET date = ?, text = ?, updated_at = ? WHERE id = ?`).run(
      date,
      text,
      at,
      noteId
    )
  } catch (error) {
    if (isSqliteError(error)) throw new StorageError('Could not save the note')
    throw error
  }
  return requireNote(db, noteId)
}

/** False when the note is unknown. */
export function deleteNote(db: SqliteDatabase, id: string): boolean {
  const noteId = assertId(id)
  try {
    return db.prepare(`DELETE FROM notes WHERE id = ?`).run(noteId).changes === 1
  } catch (error) {
    if (isSqliteError(error)) throw new StorageError('Could not delete the note')
    throw error
  }
}

export function getNote(db: SqliteDatabase, id: string): PageNote | null {
  const row = db.prepare<unknown[], NoteSql>(`${NOTE_SELECT} WHERE id = ?`).get(assertId(id))
  return row === undefined ? null : fromSql(row)
}

/** A page's notes, newest date first, then newest logged first. */
export function listNotes(db: SqliteDatabase, pageId: string): PageNote[] {
  return db
    .prepare<unknown[], NoteSql>(
      `${NOTE_SELECT} WHERE page_id = ? ORDER BY date DESC, created_at DESC, rowid DESC`
    )
    .all(assertId(pageId))
    .map(fromSql)
}

/** Trimmed note text. Empty, too long, or secret-shaped text is refused. */
export function requireNoteText(value: string): string {
  if (typeof value !== 'string') throw new StorageError('Invalid note')
  const text = value.trim()
  if (text.length === 0) throw new StorageError('Write the note first')
  if (text.length > NOTE_TEXT_MAX) {
    throw new StorageError(`A note can be up to ${NOTE_TEXT_MAX} characters`)
  }
  return requireStoredText(text, 'note', NOTE_TEXT_MAX)
}

const NOTE_SELECT = `SELECT id, page_id, date, text, created_at, updated_at FROM notes`

interface NoteSql {
  id: string
  page_id: string
  date: string
  text: string
  created_at: string
  updated_at: string
}

function fromSql(row: NoteSql): PageNote {
  return {
    id: row.id,
    pageId: row.page_id,
    date: row.date,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function requireNote(db: SqliteDatabase, id: string): PageNote {
  const note = getNote(db, id)
  if (note === null) throw new StorageError('Unknown note')
  return note
}

function requirePage(db: SqliteDatabase, pageId: string): void {
  const page = db.prepare(`SELECT 1 AS ok FROM pages WHERE id = ?`).get(pageId)
  if (page === undefined) throw new StorageError('Unknown page')
}
