import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, column, tableNames, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { SITE_OVERRIDES_VERSION } from './project-schema-site-overrides'
import {
  readSiteTypeSettings,
  removeCustomSiteType,
  saveCustomSiteType,
  setSiteOverride
} from './site-overrides'

/** Project database upgrade 048: the user's type of site and role per domain, and custom types. */

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-29T09:00:00.000Z'

function upTo(version: number): SqliteDatabase {
  const at = PROJECT_MIGRATIONS.findIndex((item) => item.version === version)
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS.slice(0, at))
  return db
}

function current(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS)
  return db
}

describe('project migration 048', () => {
  test('is a project migration and adds both tables', () => {
    expect(PROJECT_MIGRATIONS.find((item) => item.version === SITE_OVERRIDES_VERSION)?.name).toBe(
      '048_site_overrides'
    )
    const db = upTo(SITE_OVERRIDES_VERSION)
    expect(tableNames(db)).not.toContain('site_overrides')
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db).map((item) => item.version)).toContain(SITE_OVERRIDES_VERSION)
    expect(tableNames(db)).toEqual(expect.arrayContaining(['site_overrides', 'custom_site_types']))
    expect(column(db, 'site_overrides', 'site_type')?.notnull).toBe(0)
    expect(column(db, 'site_overrides', 'role')?.notnull).toBe(0)
    expect(column(db, 'custom_site_types', 'tone')?.dflt_value).toBe("'neutral'")
  })

  test('a project file from before 048 reads as nothing set', () => {
    const db = upTo(SITE_OVERRIDES_VERSION)
    expect(readSiteTypeSettings(db)).toEqual({ overrides: [], customTypes: [] })
  })

  test('the tables refuse a bad role, a bad colour and an empty row', () => {
    const db = current()
    const insert = db.prepare(
      'INSERT INTO site_overrides (domain, site_type, role, updated_at) VALUES (?, ?, ?, ?)'
    )
    expect(() => insert.run('reddit.com', null, 'competitor', NOW)).toThrow()
    expect(() => insert.run('reddit.com', null, null, NOW)).toThrow()
    expect(() =>
      db
        .prepare(
          `INSERT INTO custom_site_types (id, name, tone, created_at) VALUES ('t1', 'Partner', 'pink', ?)`
        )
        .run(NOW)
    ).toThrow()
  })
})

describe('site overrides', () => {
  test('a type and a role are set, changed one at a time, and cleared', () => {
    const db = current()
    const first = setSiteOverride(
      db,
      { domain: 'https://www.Reddit.com/r/msp', role: 'social' },
      NOW
    )
    expect(first).toEqual({
      previous: null,
      override: { domain: 'reddit.com', type: null, role: 'social' }
    })
    const second = setSiteOverride(db, { domain: 'reddit.com', type: 'news' }, NOW)
    expect(second.previous).toEqual({ domain: 'reddit.com', type: null, role: 'social' })
    expect(second.override).toEqual({ domain: 'reddit.com', type: 'news', role: 'social' })
    setSiteOverride(db, { domain: 'reddit.com', role: null }, NOW)
    expect(readSiteTypeSettings(db).overrides).toEqual([
      { domain: 'reddit.com', type: 'news', role: null }
    ])
    const cleared = setSiteOverride(db, { domain: 'reddit.com', type: null }, NOW)
    expect(cleared.override).toBeNull()
    expect(readSiteTypeSettings(db).overrides).toEqual([])
  })

  test('refuses a bad domain, type or role', () => {
    const db = current()
    expect(() => setSiteOverride(db, { domain: '', role: 'social' }, NOW)).toThrow('Invalid domain')
    expect(() => setSiteOverride(db, { domain: 'a.com', type: 'yours' as never }, NOW)).toThrow(
      'Invalid site type'
    )
    expect(() =>
      setSiteOverride(db, { domain: 'a.com', role: 'competitor' as never }, NOW)
    ).toThrow('Invalid role')
    expect(() => setSiteOverride(db, { domain: 'a.com', type: 'custom:nope' }, NOW)).toThrow(
      'no longer exists'
    )
  })

  test('custom types: add, rename, unique names, and delete puts domains back to automatic', () => {
    const db = current()
    saveCustomSiteType(db, { id: 't1', name: '  Partner  site ', tone: 'ok' }, NOW)
    saveCustomSiteType(db, { id: 't2', name: 'Reseller', tone: 'info' }, NOW)
    expect(() =>
      saveCustomSiteType(db, { id: 't3', name: 'partner site', tone: 'ok' }, NOW)
    ).toThrow('There is already a type called partner site')
    saveCustomSiteType(db, { id: 't1', name: 'Partner', tone: 'warn' }, NOW)
    setSiteOverride(db, { domain: 'acme.com', type: 'custom:t1' }, NOW)
    setSiteOverride(db, { domain: 'beta.com', type: 'custom:t1', role: 'media' }, NOW)
    expect(readSiteTypeSettings(db)).toEqual({
      customTypes: [
        { id: 't1', name: 'Partner', tone: 'warn' },
        { id: 't2', name: 'Reseller', tone: 'info' }
      ],
      overrides: [
        { domain: 'acme.com', type: 'custom:t1', role: null },
        { domain: 'beta.com', type: 'custom:t1', role: 'media' }
      ]
    })
    expect(removeCustomSiteType(db, 't1')).toBe(2)
    expect(readSiteTypeSettings(db)).toEqual({
      customTypes: [{ id: 't2', name: 'Reseller', tone: 'info' }],
      overrides: [{ domain: 'beta.com', type: null, role: 'media' }]
    })
    expect(() => removeCustomSiteType(db, 't1')).toThrow('no longer exists')
  })
})
