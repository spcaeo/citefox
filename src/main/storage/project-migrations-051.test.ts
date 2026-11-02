import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { migrate } from './migrate'
import { applied, closeTracked, tableNames, track } from './migrate.test-helper'
import { listPageFixBriefs, putPageFixBrief, toBriefContent } from './page-fix-briefs'
import { PROJECT_MIGRATIONS } from './project-schema'
import { PAGE_FIX_BRIEFS_VERSION } from './project-schema-page-fix-briefs'

/** Project database upgrade 051: saved page fix briefs (What to fix's Status). */

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-29T12:00:00.000Z'
const LATER = '2026-10-29T12:05:00.000Z'

const BRIEF = {
  title: 'Fix brief',
  summary: 'Add a pricing table.',
  items: [{ id: 'step-0', label: 'Step', text: 'Add the table.' }],
  text: 'Add a pricing table.\n- Add the table.',
  writeWithUrl: null,
  note: 'CiteFox AI · about 6 s · no searches'
}

function upTo(version: number): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    PROJECT_MIGRATIONS.filter((item) => item.version < version)
  )
  return db
}

describe('project migration 051_page_fix_briefs', () => {
  test('follows 050 and starts with no saved brief', () => {
    const db = upTo(PAGE_FIX_BRIEFS_VERSION)
    expect(tableNames(db)).not.toContain('page_fix_briefs')

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db)).toContainEqual({ version: 51, name: '051_page_fix_briefs' })
    expect(tableNames(db)).toContain('page_fix_briefs')
    expect(listPageFixBriefs(db)).toEqual([])
  })

  test('saves a brief, replaces it for the same fix and lists the newest first', () => {
    const db = upTo(PAGE_FIX_BRIEFS_VERSION + 1)
    putPageFixBrief(db, { fixId: 'pfabc', brief: BRIEF, savedAt: NOW })
    putPageFixBrief(db, { fixId: 'pfdef', brief: BRIEF, savedAt: NOW })
    putPageFixBrief(db, {
      fixId: 'pfabc',
      brief: { ...BRIEF, summary: 'Newer.' },
      savedAt: LATER
    })
    const list = listPageFixBriefs(db)
    expect(list.map((item) => item.fixId)).toEqual(['pfabc', 'pfdef'])
    expect(list[0]?.brief.summary).toBe('Newer.')
    expect(list[0]?.savedAt).toBe(LATER)
  })

  test('refuses a brief that is not one, and skips a damaged row', () => {
    const db = upTo(PAGE_FIX_BRIEFS_VERSION + 1)
    expect(() =>
      putPageFixBrief(db, { fixId: 'pfabc', brief: { ...BRIEF, title: '' }, savedAt: NOW })
    ).toThrow(StorageError)
    expect(toBriefContent({ ...BRIEF, writeWithUrl: 'javascript:alert(1)' })).toBeNull()
    expect(toBriefContent({ ...BRIEF, extra: 1 })).toBeNull()
    expect(toBriefContent({ ...BRIEF, writeWithUrl: 'https://example.com/write' })).not.toBeNull()
    db.prepare(
      `INSERT INTO page_fix_briefs (fix_id, brief_json, saved_at) VALUES ('pfbad', '{"x":1}', ?)`
    ).run(NOW)
    expect(listPageFixBriefs(db)).toEqual([])
    expect(() =>
      db
        .prepare(`INSERT INTO page_fix_briefs (fix_id, brief_json, saved_at) VALUES ('', '{}', ?)`)
        .run(NOW)
    ).toThrow(/CHECK/)
  })
})
