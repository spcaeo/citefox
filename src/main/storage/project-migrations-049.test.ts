import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  hasGuideSignal,
  readGuide,
  recordGuideSignal,
  restartGuide,
  writeGuide
} from './guide-progress'
import { migrate } from './migrate'
import { applied, closeTracked, tableNames, track } from './migrate.test-helper'
import { GUIDE_VERSION } from './project-schema-guide'
import { PROJECT_MIGRATIONS } from './project-schema'

/** Project database upgrade 049: the first-run guide's progress. */

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-29T09:00:00.000Z'
const LATER = '2026-10-29T09:05:00.000Z'

function upTo(version: number): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    PROJECT_MIGRATIONS.filter((item) => item.version < version)
  )
  return db
}

function fresh(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS)
  return db
}

describe('project migration 049', () => {
  test('adds the four guide tables to an existing project, which starts with no progress', () => {
    const db = upTo(GUIDE_VERSION)
    expect(tableNames(db)).not.toContain('guide_state')
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db)).toContainEqual({ version: 49, name: '049_guide' })
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['guide_steps', 'guide_signals', 'guide_explainers', 'guide_state'])
    )
    expect(readGuide(db, 'p1')).toEqual({
      projectId: 'p1',
      steps: {},
      signals: [],
      current: null,
      paused: null,
      hidden: false,
      tipsOff: false,
      kickoff: 'none',
      explainersSeen: []
    })
  })

  test('the database refuses a bad state, kick-off or half a pause', () => {
    const db = fresh()
    expect(() =>
      db.prepare(`INSERT INTO guide_steps VALUES ('a', 'started', ?)`).run(NOW)
    ).toThrow()
    expect(() =>
      db
        .prepare(`INSERT INTO guide_state (id, kickoff, updated_at) VALUES (1, 'maybe', ?)`)
        .run(NOW)
    ).toThrow()
    expect(() =>
      db
        .prepare(`INSERT INTO guide_state (id, paused_step, updated_at) VALUES (1, 'a', ?)`)
        .run(NOW)
    ).toThrow()
    expect(() =>
      db.prepare(`INSERT INTO guide_state (id, updated_at) VALUES (2, ?)`).run(NOW)
    ).toThrow()
  })
})

describe('guide progress storage', () => {
  test('saves steps, the current step, a pause with its exact route, and flags', () => {
    const db = fresh()
    writeGuide(db, 'p1', { steps: { 'topic-kpis': 'done', 'set-target-page': 'shown' } }, NOW)
    const saved = writeGuide(
      db,
      'p1',
      {
        current: 'set-target-page',
        paused: { stepId: 'set-target-page', route: '#/topics/t1?drawer=topic-page' },
        kickoff: 'started'
      },
      LATER
    )
    expect(saved.steps).toEqual({ 'topic-kpis': 'done', 'set-target-page': 'shown' })
    expect(saved.current).toBe('set-target-page')
    expect(saved.paused).toEqual({
      stepId: 'set-target-page',
      route: '#/topics/t1?drawer=topic-page',
      at: LATER
    })
    expect(saved.kickoff).toBe('started')
    const resumed = writeGuide(db, 'p1', { paused: null, steps: { 'topic-kpis': null } }, LATER)
    expect(resumed.paused).toBeNull()
    expect(resumed.current).toBe('set-target-page')
    expect(resumed.steps).toEqual({ 'set-target-page': 'shown' })
    const hidden = writeGuide(db, 'p1', { hidden: true, tipsOff: true }, LATER)
    expect([hidden.hidden, hidden.tipsOff]).toEqual([true, true])
  })

  test('records a signal once, keeps explainers, and Restart clears everything', () => {
    const db = fresh()
    expect(hasGuideSignal(db, 'competitor-saved')).toBe(false)
    recordGuideSignal(db, 'p1', 'competitor-saved', NOW)
    recordGuideSignal(db, 'p1', 'target-page-set', LATER)
    const again = recordGuideSignal(db, 'p1', 'competitor-saved', LATER)
    expect(again.signals).toEqual(['competitor-saved', 'target-page-set'])
    expect(hasGuideSignal(db, 'competitor-saved')).toBe(true)
    writeGuide(db, 'p1', { explainerSeen: 'competitors' }, NOW)
    writeGuide(db, 'p1', { explainerSeen: 'fixes', current: 'fixes' }, NOW)
    expect(readGuide(db, 'p1').explainersSeen).toEqual(['competitors', 'fixes'])
    expect(writeGuide(db, 'p1', { explainersReset: true }, NOW).explainersSeen).toEqual([])
    writeGuide(db, 'p1', { steps: { summary: 'skipped' }, tipsOff: true }, NOW)
    expect(restartGuide(db, 'p1')).toEqual(readGuide(fresh(), 'p1'))
  })

  test('refuses a web address as a route, a bad id and an unknown signal', () => {
    const db = fresh()
    expect(() =>
      writeGuide(db, 'p1', { paused: { stepId: 'a', route: 'https://example.com' } }, NOW)
    ).toThrow(StorageError)
    expect(() => writeGuide(db, 'p1', { steps: { 'Bad Id': 'done' } }, NOW)).toThrow(StorageError)
    expect(() => writeGuide(db, 'p1', { current: 'x'.repeat(81) }, NOW)).toThrow(StorageError)
    expect(() => recordGuideSignal(db, 'p1', 'nope' as never, NOW)).toThrow(StorageError)
    expect(readGuide(db, 'p1').paused).toBeNull()
  })
})
