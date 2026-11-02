import { afterEach, describe, expect, test } from 'vitest'
import type { OverviewRead } from '@shared/overview-read'
import { openSqliteDatabase } from './database'
import { migrate } from './migrate'
import { closeTracked, track } from './migrate.test-helper'
import { listOverviewReads, saveOverviewRead } from './overview-reads'
import { PROJECT_MIGRATIONS } from './project-schema'
import { OVERVIEW_READS_VERSION } from './project-schema-overview-reads'

const READ: OverviewRead = {
  positioning: 'One middleware option.',
  tone: { value: 'neutral', quote: 'a service like TextBolt or .' },
  competitors: [],
  actions: [{ text: 'Add a setup section.', basis: 'textbolt.com' }],
  confidence: { level: 'low', reason: 'One sample.' }
}

afterEach(() => {
  closeTracked()
})

/** A project database with foreign keys off, so a read needs no stored check around it. */
function projectDb(): ReturnType<typeof openSqliteDatabase> {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS)
  db.pragma('foreign_keys = OFF')
  return db
}

describe('overview read storage', () => {
  test('is project migration 35', () => {
    expect(PROJECT_MIGRATIONS.find((m) => m.version === OVERVIEW_READS_VERSION)).toMatchObject({
      version: 35,
      name: '035_overview_reads'
    })
  })

  test('saves one read per sample, replaces it, and lists in the order asked', () => {
    const db = projectDb()
    saveOverviewRead(db, { sampleId: 'sr-1', ranAt: '2026-10-22T09:00:00.000Z', read: READ })
    saveOverviewRead(db, { sampleId: 'sr-2', ranAt: '2026-10-22T09:01:00.000Z', read: READ })
    const again = { ...READ, positioning: 'Named first.' }
    saveOverviewRead(db, { sampleId: 'sr-1', ranAt: '2026-10-23T08:00:00.000Z', read: again })
    expect(listOverviewReads(db, ['sr-2', 'sr-1', 'sr-9'])).toEqual([
      { sampleId: 'sr-2', ranAt: '2026-10-22T09:01:00.000Z', read: READ },
      { sampleId: 'sr-1', ranAt: '2026-10-23T08:00:00.000Z', read: again }
    ])
    expect(listOverviewReads(db, [])).toEqual([])
  })

  test('leaves out a row whose JSON no longer reads, and refuses bad input', () => {
    const db = projectDb()
    db.prepare(
      `INSERT INTO overview_reads (serp_result_id, read_json, ran_at) VALUES ('sr-3', '{"x":1}', 'now')`
    ).run()
    expect(listOverviewReads(db, ['sr-3'])).toEqual([])
    expect(() =>
      saveOverviewRead(db, { sampleId: 'sr-4', ranAt: 'yesterday', read: READ })
    ).toThrow()
    expect(() => listOverviewReads(db, ['bad id'])).toThrow()
  })
})
