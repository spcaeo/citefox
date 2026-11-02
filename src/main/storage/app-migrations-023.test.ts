import { afterEach, describe, expect, test } from 'vitest'
import { addKeyUsage, getApiKey, getKeyUsage, insertApiKey, updateApiKey } from './api-key-records'
import { APP_MIGRATIONS } from './app-schema'
import { CLORO_APP_VERSION } from './app-schema-cloro'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, column, foreignKeys, indexSql, track } from './migrate.test-helper'

/** App database upgrade 023: cloro keys and the credits each key spent. */

afterEach(() => {
  closeTracked()
})

function before023(): SqliteDatabase {
  const at = APP_MIGRATIONS.findIndex((item) => item.version === CLORO_APP_VERSION)
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, APP_MIGRATIONS.slice(0, at))
  return db
}

describe('app migration 023_cloro_keys', () => {
  test('follows 022 and keeps every key, its events and its usage as they were', () => {
    const at = APP_MIGRATIONS.findIndex((item) => item.version === CLORO_APP_VERSION)
    expect(APP_MIGRATIONS[at]).toMatchObject({ version: 23, name: '023_cloro_keys' })
    expect(APP_MIGRATIONS[at - 1]?.version).toBe(22)
    const db = before023()
    db.prepare(
      `INSERT INTO api_keys (
         id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
         serpapi_used, serpapi_limit, serpapi_plan, last_reason, plan
       ) VALUES ('key-1', 'serpapi', 'Primary', 'citefox.serpapi.key-1', 0, 80, 1, '[]', 'ab12',
         'ok', 12, 250, 'Developer', NULL, 'Starter')`
    ).run()
    db.prepare(
      `INSERT INTO connection_events (id, key_id, at, kind, detail)
       VALUES ('event-1', 'key-1', '2026-10-01T00:00:00.000Z', 'failover', 'moved')`
    ).run()
    db.prepare(
      `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens)
       VALUES ('usage-1', 'key-1', NULL, '2026-10', 4, 1, 0)`
    ).run()
    const keyBefore = db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys`).all()
    const indexes = indexSql(db, 'api_keys')

    migrate(db, APP_MIGRATIONS)

    expect(indexSql(db, 'api_keys')).toEqual(indexes)
    expect(applied(db).find((row) => row.version === 23)).toEqual({
      version: 23,
      name: '023_cloro_keys'
    })
    const keyAfter = db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM api_keys`).all()
    expect(keyAfter).toEqual(
      keyBefore.map((row) => ({
        ...row,
        cloro_remaining: null,
        cloro_per_cycle: null,
        cloro_resets_at: null
      }))
    )
    expect(getApiKey(db, 'key-1')?.cloroCredits).toBeNull()
    expect(db.prepare<unknown[], { id: string }>(`SELECT id FROM connection_events`).all()).toEqual(
      [{ id: 'event-1' }]
    )
    expect(foreignKeys(db, 'connection_events').map((row) => row.table)).toContain('api_keys')
    expect(column(db, 'key_usage', 'credits')).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect(getKeyUsage(db, 'usage-1')).toMatchObject({ searches: 4, credits: 0 })
  })

  test('stores a cloro key, its balance and the credits it spent', () => {
    const db = before023()
    migrate(db, APP_MIGRATIONS)
    insertApiKey(db, {
      id: 'key-c',
      provider: 'cloro',
      name: 'cloro',
      keychainRef: 'citefox.cloro.key-c',
      rotationOrder: 0,
      cap: null,
      on: true,
      projectIds: [],
      hint: 'wxyz',
      state: 'unchecked',
      lastReason: null,
      serpapiUsage: null,
      plan: null,
      cloroCredits: null
    })
    const key = getApiKey(db, 'key-c')
    expect(key?.provider).toBe('cloro')
    if (key === null) throw new Error('missing key')
    updateApiKey(db, {
      ...key,
      state: 'ok',
      cloroCredits: { remaining: 37_120, perCycle: 37_500, resetsAt: '2026-11-01T00:00:00.000Z' }
    })
    expect(getApiKey(db, 'key-c')?.cloroCredits).toEqual({
      remaining: 37_120,
      perCycle: 37_500,
      resetsAt: '2026-11-01T00:00:00.000Z'
    })

    addKeyUsage(db, {
      id: 'usage-c',
      keyId: 'key-c',
      projectId: null,
      month: '2026-10',
      searches: 1,
      calls: 0,
      tokens: 0,
      credits: 7
    })
    addKeyUsage(db, {
      id: 'usage-c2',
      keyId: 'key-c',
      projectId: null,
      month: '2026-10',
      searches: 1,
      calls: 0,
      tokens: 0,
      credits: 6
    })
    expect(getKeyUsage(db, 'usage-c')).toMatchObject({ searches: 2, credits: 13 })

    // A balance belongs to a cloro key only.
    expect(() =>
      db
        .prepare(`UPDATE api_keys SET provider = 'jina', cloro_remaining = 5 WHERE id = 'key-c'`)
        .run()
    ).toThrow(/CHECK/)
    expect(() =>
      db.prepare(`UPDATE api_keys SET cloro_remaining = -1 WHERE id = 'key-c'`).run()
    ).toThrow(/CHECK/)
  })
})
