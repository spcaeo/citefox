import { afterEach, describe, expect, test } from 'vitest'
import type { PageEditResult } from '@shared/ipc'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { migrate } from './migrate'
import { applied, closeTracked, tableNames, track } from './migrate.test-helper'
import { getPageEdit, putPageEdit, toPageEdit } from './page-edits'
import { PROJECT_MIGRATIONS } from './project-schema'
import { PAGE_EDITS_VERSION } from './project-schema-page-edits'

/** Project database upgrade 052: saved page edits (What to fix › Page edits). */

afterEach(() => {
  closeTracked()
})

const EDIT: PageEditResult = {
  fixId: 'pfabc',
  url: 'https://example.com/blog/post',
  title: 'Post',
  readAt: '2026-10-30T10:00:00.000Z',
  blocks: [
    { id: 'b1', kind: 'h1', text: 'Post' },
    { id: 'b2', kind: 'p', text: 'Old intro.' }
  ],
  changes: [
    { id: 'c1', op: 'replace', block: 'b2', kind: 'p', text: 'New intro.', why: 'Answers first.' },
    { id: 'c2', op: 'insert', after: null, kind: 'p', text: 'Top note.', why: 'Context.' },
    { id: 'c3', op: 'delete', block: 'b1', why: 'Duplicate.' }
  ],
  summary: 'Answers the main search first.',
  note: 'CiteFox AI · about 40 s · no searches',
  savedAt: '2026-10-30T10:01:00.000Z'
}

function upTo(version: number): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    PROJECT_MIGRATIONS.filter((item) => item.version < version)
  )
  return db
}

describe('project migration 052_page_edits', () => {
  test('follows 051 and starts empty', () => {
    const db = upTo(PAGE_EDITS_VERSION)
    expect(tableNames(db)).not.toContain('page_edits')
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db)).toContainEqual({ version: 52, name: '052_page_edits' })
    expect(getPageEdit(db, 'pfabc')).toBeNull()
  })

  test('saves edits and replaces them for the same fix', () => {
    const db = upTo(PAGE_EDITS_VERSION + 1)
    putPageEdit(db, EDIT)
    putPageEdit(db, { ...EDIT, summary: 'Newer.', savedAt: '2026-10-30T11:00:00.000Z' })
    expect(getPageEdit(db, 'pfabc')?.summary).toBe('Newer.')
    expect(getPageEdit(db, 'pfabc')?.changes).toEqual(EDIT.changes)
  })

  test('refuses a change that names a block the page does not have', () => {
    const db = upTo(PAGE_EDITS_VERSION + 1)
    const bad = { ...EDIT, changes: [{ id: 'c1', op: 'delete' as const, block: 'b9', why: 'x' }] }
    expect(toPageEdit(bad)).toBeNull()
    expect(() => putPageEdit(db, bad)).toThrow(StorageError)
  })
})
