import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, type SqliteDatabase } from './database'
import { openAppDatabase } from './app-database'
import type { ClaudeCheckupResult } from '@shared/ipc'
import {
  getApiKey,
  getApiKeyByProvider,
  getClaudeCheckup,
  getConnectionEvent,
  getKeyUsage,
  getLatestClaudeCheckup,
  getProject,
  getTemplate,
  insertApiKey,
  insertClaudeCheckup,
  listApiKeysByProvider,
  insertConnectionEvent,
  insertKeyUsage,
  insertProject,
  insertTemplate,
  type ProjectRecord
} from './records'
import { projectDatabaseRelativePath } from './slug'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('app records', () => {
  test('stores a null cap and an empty project list without a secret', () => {
    const db = memory()
    insertProject(db, project())
    insertApiKey(db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'Primary',
      keychainRef: 'citefox.serpapi.key-1',
      rotationOrder: 0,
      cap: null,
      on: true,
      projectIds: [],
      hint: 'ab12',
      state: 'unchecked',
      lastReason: null,
      serpapiUsage: { used: 12, planLimit: 250, plan: 'Developer' }
    })
    expect(getApiKey(db, 'key-1')).toEqual({
      id: 'key-1',
      provider: 'serpapi',
      name: 'Primary',
      keychainRef: 'citefox.serpapi.key-1',
      rotationOrder: 0,
      cap: null,
      on: true,
      projectIds: [],
      hint: 'ab12',
      state: 'unchecked',
      lastReason: null,
      serpapiUsage: { used: 12, planLimit: 250, plan: 'Developer' },
      plan: null,
      cloroCredits: null
    })

    insertApiKey(db, {
      id: 'key-2',
      provider: 'jina',
      name: 'Reader',
      keychainRef: 'citefox.jina.key-2',
      rotationOrder: 1,
      cap: 0,
      on: false,
      projectIds: ['project-1'],
      hint: '',
      state: 'off',
      lastReason: null,
      serpapiUsage: null
    })
    expect(getApiKey(db, 'key-2')?.cap).toBe(0)
    expect(getApiKey(db, 'key-2')?.on).toBe(false)
    expect(getApiKey(db, 'key-2')?.projectIds).toEqual(['project-1'])
  })

  test('rejects a secret, a bad hint, an unknown provider, and a bad status', () => {
    const db = memory()
    const secret = `sk-ant-api03-${'b'.repeat(20)}`
    expect(() =>
      insertApiKey(db, {
        id: 'key-1',
        provider: 'anthropic',
        name: secret,
        keychainRef: 'citefox.anthropic.key-1',
        rotationOrder: 0,
        cap: 100,
        on: true,
        projectIds: [],
        hint: 'wxyz',
        state: 'unchecked',
        lastReason: null,
        serpapiUsage: null
      })
    ).toThrow(/secret/)
    expect(() =>
      insertApiKey(db, {
        id: 'key-1',
        provider: 'anthropic',
        name: 'Claude',
        keychainRef: 'citefox.anthropic.key-1',
        rotationOrder: 0,
        cap: 100,
        on: true,
        projectIds: [],
        hint: secret,
        state: 'unchecked',
        lastReason: null,
        serpapiUsage: null
      })
    ).toThrow(/hint/)
    expect(() =>
      insertApiKey(db, {
        id: 'key-1',
        provider: 'claude-code' as 'anthropic',
        name: 'Claude',
        keychainRef: 'citefox.anthropic.key-1',
        rotationOrder: 0,
        cap: null,
        on: true,
        projectIds: [],
        hint: 'wxyz',
        state: 'unchecked',
        lastReason: null,
        serpapiUsage: null
      })
    ).toThrow(/provider/)
    expect(() =>
      insertApiKey(db, {
        id: 'key-1',
        provider: 'jina',
        name: 'Reader',
        keychainRef: 'citefox.jina.key-1',
        rotationOrder: 0,
        cap: null,
        on: true,
        projectIds: [],
        hint: '',
        state: 'sideways' as 'off',
        lastReason: null,
        serpapiUsage: null
      })
    ).toThrow(/connection state/)
    expect(() => insertProject(db, { ...project(), status: 'deleted' as 'active' })).toThrow(
      /status/
    )
    expect(() =>
      insertApiKey(db, {
        id: 'key-1',
        provider: 'jina',
        name: 'Reader',
        keychainRef: 'citefox.jina.key-1',
        rotationOrder: 0,
        cap: null,
        on: true,
        projectIds: [],
        hint: '',
        state: 'warning',
        lastReason: 'nope' as 'other',
        serpapiUsage: null
      })
    ).toThrow(/last reason/)
    expect(getApiKey(db, 'key-1')).toBeNull()
  })

  test('enforces foreign keys, unique slugs, and the relative database path', () => {
    const db = memory()
    insertProject(db, project())
    expect(() => insertProject(db, { ...project(), id: 'project-2' })).toThrow(/already exists/)
    expect(() =>
      insertProject(db, {
        ...project(),
        id: 'project-2',
        slug: 'other',
        dbPath: '/tmp/other.sqlite'
      })
    ).toThrow(/path/)
    expect(() =>
      insertKeyUsage(db, {
        id: 'usage-1',
        keyId: 'missing',
        projectId: 'project-missing',
        month: '2026-10',
        searches: 1,
        calls: 0,
        tokens: 0
      })
    ).toThrow(/missing/)

    insertApiKey(db, {
      id: 'key-1',
      provider: 'youtube',
      name: 'Videos',
      keychainRef: 'citefox.youtube.key-1',
      rotationOrder: 2,
      cap: 10,
      on: true,
      projectIds: [],
      hint: '9876',
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    insertKeyUsage(db, {
      id: 'usage-1',
      keyId: 'key-1',
      projectId: 'project-1',
      month: '2026-10',
      searches: 4,
      calls: 1,
      tokens: 20
    })
    expect(getKeyUsage(db, 'usage-1')?.month).toBe('2026-10')
    expect(() =>
      insertKeyUsage(db, {
        id: 'usage-2',
        keyId: 'key-1',
        projectId: 'project-1',
        month: '2026-10',
        searches: 0,
        calls: 0,
        tokens: 0
      })
    ).toThrow(/already exists/)

    insertConnectionEvent(db, {
      id: 'event-1',
      keyId: 'key-1',
      at: '2026-10-19T12:00:00.000Z',
      kind: 'failover',
      detail: 'Switched to the next key'
    })
    expect(getConnectionEvent(db, 'event-1')?.kind).toBe('failover')
    expect(() =>
      insertConnectionEvent(db, {
        id: 'event-2',
        keyId: 'key-1',
        at: '2026-10-19T12:00:00.000Z',
        kind: 'failover',
        detail: `sk-ant-api03-${'c'.repeat(20)}`
      })
    ).toThrow(/secret/)
  })

  test('stores a template version with json schema text', () => {
    const db = memory()
    insertTemplate(db, {
      id: 'tpl-1',
      name: 'icp.md',
      version: 1,
      hash: 'abc123',
      body: 'Hello {{ page.title }}',
      schema: '{"type":"object"}',
      settingsJson: null,
      kind: 'buyer_profile',
      notes: null,
      isShipped: false,
      isDefault: true,
      createdAt: '2026-10-19T12:00:00.000Z',
      updatedAt: null,
      deletedAt: null
    })
    expect(getTemplate(db, 'tpl-1')).toMatchObject({ name: 'icp.md', schema: '{"type":"object"}' })
    expect(() =>
      insertTemplate(db, {
        id: 'tpl-2',
        name: 'Other',
        version: 1,
        hash: 'def456',
        body: 'other',
        schema: null,
        settingsJson: null,
        kind: 'buyer_profile',
        notes: null,
        isShipped: false,
        isDefault: true,
        createdAt: '2026-10-19T12:00:00.000Z',
        updatedAt: null,
        deletedAt: null
      })
    ).toThrow(/already exists/)
    expect(getProject(db, 'missing')).toBeNull()
  })

  test('stores several keys for one provider in rotation order', () => {
    const db = memory()
    insertProject(db, project())
    insertApiKey(db, {
      id: 'key-later',
      provider: 'serpapi',
      name: 'Later',
      keychainRef: 'citefox.serpapi.key-later',
      rotationOrder: 2,
      cap: 10,
      on: false,
      projectIds: [],
      hint: 'cd34',
      state: 'off',
      lastReason: null,
      serpapiUsage: { used: 4, planLimit: 250, plan: 'Developer' }
    })
    insertApiKey(db, {
      id: 'key-first',
      provider: 'serpapi',
      name: 'First',
      keychainRef: 'citefox.serpapi.key-first',
      rotationOrder: 0,
      cap: null,
      on: true,
      projectIds: ['project-1'],
      hint: 'ab12',
      state: 'ok',
      lastReason: null,
      serpapiUsage: { used: 12, planLimit: 250, plan: 'Developer' }
    })
    expect(getApiKeyByProvider(db, 'serpapi')?.id).toBe('key-first')
    expect(listApiKeysByProvider(db, 'serpapi').map((key) => key.id)).toEqual([
      'key-first',
      'key-later'
    ])
    expect(getApiKey(db, 'key-later')).toMatchObject({
      name: 'Later',
      rotationOrder: 2,
      on: false,
      cap: 10
    })
    expect(() =>
      insertApiKey(db, {
        id: 'key-copy',
        provider: 'serpapi',
        name: 'Copy',
        keychainRef: 'citefox.serpapi.key-first',
        rotationOrder: 1,
        cap: null,
        on: true,
        projectIds: [],
        hint: 'ab12',
        state: 'unchecked',
        lastReason: null,
        serpapiUsage: null
      })
    ).toThrow(/already exists/)
    expect(getApiKey(db, 'key-copy')).toBeNull()
  })

  test('stores each checkup and reads the latest row', () => {
    const db = memory()
    const older = checkupResult(false)
    const newer = checkupResult(true)
    insertClaudeCheckup(db, {
      id: 'checkup-1',
      ranAt: '2026-10-19T12:00:00.000Z',
      result: older
    })
    insertClaudeCheckup(db, {
      id: 'checkup-2',
      ranAt: '2026-10-19T13:00:00.000Z',
      result: newer
    })
    expect(getClaudeCheckup(db, 'checkup-1')?.binaryOk).toBe(false)
    expect(getClaudeCheckup(db, 'checkup-1')?.loginOk).toBe(false)
    expect(getClaudeCheckup(db, 'checkup-1')?.roundTripOk).toBe(false)
    const latest = getLatestClaudeCheckup(db)
    expect(latest?.id).toBe('checkup-2')
    expect(latest?.binaryOk).toBe(true)
    expect(latest?.loginOk).toBe(true)
    expect(latest?.roundTripOk).toBe(true)
    expect(latest?.result.ready).toBe(true)
    expect(latest?.result.plan).toBe('Claude Max')
    expect(latest?.result.resolvedModel).toBe('claude-sonnet-5-5')
    const secret = `sk-ant-api03-${'e'.repeat(20)}`
    expect(() =>
      insertClaudeCheckup(db, {
        id: 'checkup-3',
        ranAt: '2026-10-19T14:00:00.000Z',
        result: { ...newer, message: `leaked ${secret}` }
      })
    ).toThrow(/secret/)
    expect(getClaudeCheckup(db, 'checkup-3')).toBeNull()
  })

  test('reads a checkup stored before resolvedModel as null', () => {
    const db = memory()
    const { resolvedModel: _dropped, ...legacy } = checkupResult(true)
    void _dropped
    db.prepare(
      `INSERT INTO claude_checkups (id, ran_at, binary_ok, login_ok, roundtrip_ok, detail_json)
       VALUES (?, ?, 1, 1, 1, ?)`
    ).run('legacy-checkup', '2026-10-19T15:00:00.000Z', JSON.stringify(legacy))
    expect(getClaudeCheckup(db, 'legacy-checkup')?.result.resolvedModel).toBeNull()
    expect(JSON.stringify(getLatestClaudeCheckup(db)?.result)).toContain('"resolvedModel":null')
  })
})

function checkupResult(ready: boolean): ClaudeCheckupResult {
  if (!ready) {
    return {
      binaryPath: null,
      version: null,
      login: 'skipped',
      plan: null,
      roundTrip: 'skipped',
      durationMs: null,
      resolvedModel: null,
      ready: false,
      message: 'Claude Code was not found.',
      nextStep: 'Install Claude Code, or set the path in Settings, then check again.',
      rows: {
        binary: {
          state: 'warning',
          statusLabel: 'Not found on PATH',
          detail: 'CiteFox looked on your PATH and in the usual install folders.',
          nextStep: 'Install Claude Code, or set the path in Settings, then check again.'
        },
        login: {
          state: 'skipped',
          statusLabel: 'Skipped',
          detail: 'Checked after Claude Code is found',
          nextStep: null
        },
        roundTrip: {
          state: 'skipped',
          statusLabel: 'Skipped',
          detail: 'Runs after Claude Code is found',
          nextStep: null
        }
      }
    }
  }
  return {
    binaryPath: '/usr/local/bin/claude',
    version: '2.4.1',
    login: 'logged_in',
    plan: 'Claude Max',
    roundTrip: 'ok',
    durationMs: 3200,
    resolvedModel: 'claude-sonnet-5-5',
    ready: true,
    message: 'Claude Code is ready. CiteFox will run its analysis on your Claude Max plan.',
    nextStep: null,
    rows: {
      binary: {
        state: 'ok',
        statusLabel: 'OK',
        detail: '/usr/local/bin/claude · version 2.4.1',
        nextStep: null
      },
      login: { state: 'ok', statusLabel: 'OK', detail: 'Claude Max plan', nextStep: null },
      roundTrip: { state: 'ok', statusLabel: 'OK', detail: 'Replied in 3.2 s', nextStep: null }
    }
  }
}

function memory(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

function project(): ProjectRecord {
  const slug = 'textbolt'
  return {
    id: 'project-1',
    name: 'TextBolt',
    slug,
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active' as const
  }
}
