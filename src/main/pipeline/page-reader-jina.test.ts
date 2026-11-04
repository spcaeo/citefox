import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import type { HttpRequest } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { insertPage } from '../storage/pages'
import { ensureProjectSchema, writeProjectProfile } from '../storage/project-profile'
import { readPage, type JinaKeyRef, type ReadPageOptions } from './page-reader'
import { TEXTBOLT_TITLE, TEXTBOLT_URL, textboltJinaBody } from './textbolt-fixture'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

const KEYS: JinaKeyRef[] = [
  { id: 'jina-a', name: 'Key A', keychainRef: 'citefox.jina.a' },
  { id: 'jina-b', name: 'Key B', keychainRef: 'citefox.jina.b' }
]

function secrets(): MemorySecretStore {
  const store = new MemorySecretStore()
  store.set('citefox.jina.a', 'jina_secret_aaaaaaaaaaaa')
  store.set('citefox.jina.b', 'jina_secret_bbbbbbbbbbbb')
  return store
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
  insertPage(db, {
    id: 'page-1',
    projectId: 'proj-1',
    url: TEXTBOLT_URL,
    title: null,
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  return db
}

function auth(request: HttpRequest): string {
  return request.headers?.authorization ?? 'none'
}

function options(
  db: SqliteDatabase,
  respond: (request: HttpRequest) => { status: number; body: string },
  calls: string[],
  extra: Partial<ReadPageOptions> = {}
): ReadPageOptions {
  return {
    db,
    transport: {
      async request(request) {
        calls.push(auth(request))
        return respond(request)
      }
    },
    logger: createLogger({ write: () => undefined }),
    secretStore: secrets(),
    jinaKeychainRef: null,
    jinaKeys: KEYS,
    reader: 'jina',
    jinaMode: 'always',
    pageId: 'page-1',
    projectId: 'proj-1',
    now: () => '2026-10-19T12:00:00.000Z',
    clock: () => 1_000,
    sleep: async () => undefined,
    ...extra
  }
}

const REFUSED = { status: 401, body: JSON.stringify({ code: 401, message: 'Invalid key' }) }

describe('Jina Reader keys in rotation order (FR-11.5)', () => {
  test('a refused first key hands the read to the next key', async () => {
    const calls: string[] = []
    const reads: Array<string | null> = []
    const failovers: string[] = []
    const result = await readPage(
      options(
        projectDb(),
        (request) =>
          auth(request).includes('aaaa') ? REFUSED : { status: 200, body: textboltJinaBody() },
        calls,
        {
          jinaHooks: {
            onRead: (keyId) => reads.push(keyId),
            onFailover: (from, to) => failovers.push(`${from.id}->${to?.id ?? 'keyless'}`)
          }
        }
      )
    )
    expect(result.title).toBe(TEXTBOLT_TITLE)
    expect(calls).toEqual(['Bearer jina_secret_aaaaaaaaaaaa', 'Bearer jina_secret_bbbbbbbbbbbb'])
    expect(reads).toEqual(['jina-a', 'jina-b'])
    expect(failovers).toEqual(['jina-a->jina-b'])
  })

  test('when every key is refused, Reader is called without a key at the lower limit', async () => {
    const calls: string[] = []
    const failovers: string[] = []
    const result = await readPage(
      options(
        projectDb(),
        (request) =>
          auth(request) === 'none'
            ? { status: 200, body: textboltJinaBody() }
            : { status: 402, body: 'Insufficient balance' },
        calls,
        {
          jinaHooks: {
            onFailover: (from, to) => failovers.push(`${from.id}->${to?.id ?? 'keyless'}`)
          }
        }
      )
    )
    expect(result.method).toBe('jina')
    expect(calls).toEqual([
      'Bearer jina_secret_aaaaaaaaaaaa',
      'Bearer jina_secret_bbbbbbbbbbbb',
      'none'
    ])
    expect(failovers).toEqual(['jina-a->jina-b', 'jina-b->keyless'])
  })

  test('a page or server failure stops at once: another key would not help', async () => {
    const calls: string[] = []
    await expect(
      readPage(options(projectDb(), () => ({ status: 500, body: 'oops' }), calls))
    ).rejects.toThrow(/page reader/)
    expect(new Set(calls)).toEqual(new Set(['Bearer jina_secret_aaaaaaaaaaaa']))
  })

  test('no key reads keyless, and the single legacy key still works', async () => {
    const keyless: string[] = []
    await readPage(
      options(projectDb(), () => ({ status: 200, body: textboltJinaBody() }), keyless, {
        jinaKeys: []
      })
    )
    expect(keyless).toEqual(['none'])

    const legacy: string[] = []
    const { jinaKeys: _unused, ...rest } = options(
      projectDb(),
      () => ({ status: 200, body: textboltJinaBody() }),
      legacy
    )
    void _unused
    await readPage({ ...rest, jinaKeychainRef: 'citefox.jina.b' })
    expect(legacy).toEqual(['Bearer jina_secret_bbbbbbbbbbbb'])
  })

  test('a key missing from the keychain is skipped', async () => {
    const calls: string[] = []
    const store = new MemorySecretStore()
    store.set('citefox.jina.b', 'jina_secret_bbbbbbbbbbbb')
    await readPage(
      options(projectDb(), () => ({ status: 200, body: textboltJinaBody() }), calls, {
        secretStore: store
      })
    )
    expect(calls).toEqual(['Bearer jina_secret_bbbbbbbbbbbb'])
  })
})
