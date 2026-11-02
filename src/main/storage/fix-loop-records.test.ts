import { afterEach, describe, expect, test } from 'vitest'
import { page, snapshot } from '../engine/checks/checks.test-helper'
import { insertSnapshot } from './content-records'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { listFixFollowUps } from './fix-follow-ups'
import {
  getPageAiText,
  insertIndexCheck,
  latestIndexChecks,
  listPageAiTexts,
  listSnapshotStamps,
  putPageAiText,
  readLoopOwners,
  setLoopOwner
} from './fix-loop-records'
import { migrate } from './migrate'
import { applied, closeTracked, tableNames, track } from './migrate.test-helper'
import { insertPage } from './pages'
import { PROJECT_MIGRATIONS } from './project-schema'
import { FIX_LOOP_VERSION } from './project-schema-fix-loop'

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-23T12:00:00.000Z'
const LATER = '2026-10-24T12:00:00.000Z'

function projectDb(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS)
  insertPage(db, { ...page(), defaultMarketId: null })
  return db
}

describe('project migration 043_fix_loop', () => {
  test('adds the loop tables, and a fix logged before reads as a fix', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((migration) => migration.version < FIX_LOOP_VERSION)
    )
    insertPage(db, { ...page(), defaultMarketId: null })
    db.prepare(
      `INSERT INTO fixes (id, page_id, number, description, live_on, recheck_rule, markets,
         followup_run_id, verdict, created_at, followup_job_id)
       VALUES ('fix-old', 'page-1', 1, 'Added an FAQ.', ?, 'after_7_days', '["mkt-us"]',
         NULL, NULL, ?, NULL)`
    ).run(NOW, NOW)

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db)).toContainEqual({ version: 43, name: '043_fix_loop' })
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['index_checks', 'loop_owners', 'page_ai_texts'])
    )
    expect(listFixFollowUps(db).map((fix) => [fix.id, fix.kind])).toEqual([['fix-old', 'fix']])
  })
})

describe('loop owners', () => {
  test('defaults, a trimmed rename, and a reset by empty label or the default', () => {
    const db = projectDb()
    expect(readLoopOwners(db)).toEqual({
      measure: 'CiteFox',
      reoptimise: 'You',
      publish: 'Your team',
      index: 'Your team',
      backlinks: 'Your team'
    })
    expect(setLoopOwner(db, 'backlinks', '  Sam (outreach) ').backlinks).toBe('Sam (outreach)')
    expect(setLoopOwner(db, 'backlinks', 'Priya').backlinks).toBe('Priya')
    expect(db.prepare('SELECT COUNT(*) AS n FROM loop_owners').get()).toEqual({ n: 1 })
    expect(setLoopOwner(db, 'backlinks', '   ').backlinks).toBe('Your team')
    setLoopOwner(db, 'measure', 'Me')
    expect(setLoopOwner(db, 'measure', 'CiteFox').measure).toBe('CiteFox')
    expect(db.prepare('SELECT COUNT(*) AS n FROM loop_owners').get()).toEqual({ n: 0 })
  })

  test('refuses a label over 40 characters', () => {
    expect(() => setLoopOwner(projectDb(), 'publish', 'x'.repeat(41))).toThrow('Invalid owner')
  })
})

describe('index checks', () => {
  test('the newest check is the page state; older rows stay', () => {
    const db = projectDb()
    const base = {
      pageId: 'page-1',
      url: page().url ?? '',
      searches: 1,
      message: null
    }
    insertIndexCheck(db, { ...base, id: 'idx-2', state: 'indexed', checkedAt: LATER })
    insertIndexCheck(db, {
      ...base,
      id: 'idx-1',
      state: 'unknown',
      checkedAt: NOW,
      message: 'SerpApi rejected this key.'
    })
    expect(latestIndexChecks(db).get('page-1')).toMatchObject({ id: 'idx-2', state: 'indexed' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM index_checks').get()).toEqual({ n: 2 })
    expect(() =>
      insertIndexCheck(db, { ...base, id: 'idx-3', state: 'maybe' as 'indexed', checkedAt: NOW })
    ).toThrow('Invalid index state')
  })
})

describe('cached Claude texts', () => {
  test('one text per page and kind, replaced with its edited flag', () => {
    const db = projectDb()
    expect(getPageAiText(db, 'page-1', 'recovery')).toBeNull()
    putPageAiText(db, {
      pageId: 'page-1',
      kind: 'recovery',
      inputKey: 'run-1|run-2',
      text: '1. Restore the steps.',
      edited: false,
      savedAt: NOW
    })
    const edited = putPageAiText(db, {
      pageId: 'page-1',
      kind: 'recovery',
      inputKey: 'run-1|run-2',
      text: '  1. Restore the steps and the carrier section.  ',
      edited: true,
      savedAt: LATER
    })
    expect(edited.text).toBe('1. Restore the steps and the carrier section.')
    expect(getPageAiText(db, 'page-1', 'recovery')).toEqual(edited)
    putPageAiText(db, {
      pageId: 'page-1',
      kind: 'anchor',
      inputKey: 'page-1',
      text: 'text alerts for business',
      edited: false,
      savedAt: NOW
    })
    expect(listPageAiTexts(db, 'anchor').map((text) => text.text)).toEqual([
      'text alerts for business'
    ])
    expect(() => putPageAiText(db, { ...edited, text: 'x'.repeat(8001), savedAt: LATER })).toThrow(
      'Invalid saved text'
    )
  })
})

describe('page read stamps', () => {
  test('oldest first, with their titles', () => {
    const db = projectDb()
    insertSnapshot(db, { ...snapshot(), id: 'snap-2', fetchedAt: LATER, title: 'Alerts v2' })
    insertSnapshot(db, snapshot())
    expect(listSnapshotStamps(db, 'page-1').map((stamp) => [stamp.id, stamp.title])).toEqual([
      ['snap-1', 'Alerts'],
      ['snap-2', 'Alerts v2']
    ])
  })
})
