import { afterEach, describe, expect, test } from 'vitest'
import type { OwnerWhyResult } from '@shared/ipc'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { migrate } from './migrate'
import { applied, closeTracked, tableNames, track } from './migrate.test-helper'
import { getOwnerWhy, putOwnerWhy, toOwnerWhy } from './owner-whys'
import { PROJECT_MIGRATIONS } from './project-schema'
import { OWNER_WHYS_VERSION } from './project-schema-owner-whys'

/** Project database upgrade 053: saved page comparisons (What to fix › Why Google picks). */

afterEach(() => {
  closeTracked()
})

const WHY: OwnerWhyResult = {
  fixId: 'pfowner',
  targetUrl: 'https://example.com/blog/post',
  citedUrl: 'https://example.com/compare/',
  verdict: 'target',
  reason: 'The compare page lines the options up.',
  answerNeeds: ['Name the options', 'Compare cost', 'Say who each suits'],
  citedHas: [{ section: 'Opening', point: 'A table.' }],
  ownerUrl: 'https://example.com/blog/post',
  toChange: [{ section: 'Opening', change: 'Answer first.', why: 'Answers the search.' }],
  risk: null,
  overviews: 2,
  note: 'CiteFox AI · about 30 s · no searches',
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

describe('project migration 053_owner_whys', () => {
  test('follows 052 and starts empty', () => {
    const db = upTo(OWNER_WHYS_VERSION)
    expect(tableNames(db)).not.toContain('owner_whys')
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db)).toContainEqual({ version: 53, name: '053_owner_whys' })
    expect(getOwnerWhy(db, 'pfowner')).toBeNull()
  })

  test('saves a comparison and replaces it for the same fix', () => {
    const db = upTo(OWNER_WHYS_VERSION + 1)
    putOwnerWhy(db, WHY)
    putOwnerWhy(db, { ...WHY, verdict: 'cited', savedAt: '2026-10-30T11:00:00.000Z' })
    expect(getOwnerWhy(db, 'pfowner')?.verdict).toBe('cited')
    expect(getOwnerWhy(db, 'pfowner')?.toChange).toEqual(WHY.toChange)
  })

  test('refuses an unknown verdict or a change with no text', () => {
    const db = upTo(OWNER_WHYS_VERSION + 1)
    expect(toOwnerWhy({ ...WHY, verdict: 'both' })).toBeNull()
    const bad = { ...WHY, toChange: [{ section: 'Opening', change: '', why: 'x' }] }
    expect(() => putOwnerWhy(db, bad)).toThrow(StorageError)
  })
})
