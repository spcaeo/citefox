import type { PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { deleteNote, getNote, insertNote, listNotes, NOTE_TEXT_MAX, updateNote } from './notes'
import { insertPage } from './pages'
import { ensureProjectSchema, writeProjectProfile } from './project-profile'

const databases: SqliteDatabase[] = []
const AT = '2026-10-19T12:00:00.000Z'
const LATER = '2026-10-20T09:30:00.000Z'

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('page notes (FR-15.3)', () => {
  test('adds, lists newest date first, edits, and deletes a note', () => {
    const db = projectDb()
    const first = insertNote(db, note('note-1', '2026-10-08', '  Added 5 FAQs  '))
    expect(first).toEqual({
      id: 'note-1',
      pageId: 'page-1',
      date: '2026-10-08',
      text: 'Added 5 FAQs',
      createdAt: AT,
      updatedAt: AT
    })
    insertNote(db, note('note-2', '2026-10-16', 'Rewrote the intro'))
    insertNote(db, { ...note('note-3', '2026-10-16', 'Fixed a typo'), at: LATER })
    expect(listNotes(db, 'page-1').map((row) => row.id)).toEqual(['note-3', 'note-2', 'note-1'])

    const edited = updateNote(db, 'note-1', { date: '2026-10-09', text: 'Added 6 FAQs', at: LATER })
    expect(edited).toMatchObject({ date: '2026-10-09', text: 'Added 6 FAQs', updatedAt: LATER })
    expect(edited.createdAt).toBe(AT)

    expect(deleteNote(db, 'note-1')).toBe(true)
    expect(deleteNote(db, 'note-1')).toBe(false)
    expect(getNote(db, 'note-1')).toBeNull()
    expect(listNotes(db, 'page-1')).toHaveLength(2)
  })

  test('refuses an empty, long, or secret-shaped note, a bad date, and an unknown page', () => {
    const db = projectDb()
    expect(() => insertNote(db, note('n', '2026-10-08', '   '))).toThrow('Write the note first')
    expect(() => insertNote(db, note('n', '2026-10-08', 'x'.repeat(NOTE_TEXT_MAX + 1)))).toThrow(
      `up to ${NOTE_TEXT_MAX}`
    )
    expect(() =>
      insertNote(
        db,
        note('n', '2026-10-08', 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')
      )
    ).toThrow(/secret/)
    expect(() => insertNote(db, note('n', '2026-02-30', 'Bad day'))).toThrow('Invalid local date')
    expect(() => insertNote(db, { ...note('n', '2026-10-08', 'Hi'), pageId: 'nope' })).toThrow(
      'Unknown page'
    )
    expect(() => updateNote(db, 'missing', { date: '2026-10-08', text: 'Hi', at: AT })).toThrow(
      'Unknown note'
    )
    insertNote(db, note('dup', '2026-10-08', 'Once'))
    expect(() => insertNote(db, note('dup', '2026-10-08', 'Twice'))).toThrow('already exists')
  })

  test('the notes table checks its date shape', () => {
    const db = projectDb()
    expect(() =>
      db
        .prepare(
          `INSERT INTO notes (id, page_id, date, text, created_at, updated_at)
           VALUES ('n', 'page-1', 'Oct 8', 'x', ?, ?)`
        )
        .run(AT, AT)
    ).toThrow(/CHECK/)
  })
})

function note(
  id: string,
  date: string,
  text: string
): {
  id: string
  pageId: string
  date: string
  text: string
  at: string
} {
  return { id, pageId: 'page-1', date, text, at: AT }
}

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertPage(db, page())
  return db
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/alerts',
    title: null,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}
