import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlaygroundAioRequest } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import type { HttpRequest, HttpResponse } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { writeProjectScheduleCap } from '../storage/project-schedule'
import { insertApiKey, insertProject, writeActiveProjectId } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { checkPlaygroundAio, type PlaygroundHost } from './playground-save'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const PAGE = 'http://www.textbolt.com/blog/how-to-set-up-text-alerts-for-business'
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function setup(respond: (keyId: string, request: HttpRequest) => HttpResponse): {
  host: PlaygroundHost
  storage: AppStorage
  calls: string[]
} {
  const storage = openAppStorage(mkdtempSync(join(tmpdir(), 'citefox-playground-')))
  closers.push(() => storage.close())
  const secrets = new MemorySecretStore()
  for (const [index, keyId] of ['key-1', 'key-2'].entries()) {
    insertApiKey(storage.db, {
      id: keyId,
      provider: 'serpapi',
      name: `Key ${index + 1}`,
      keychainRef: `citefox.serpapi.${keyId}`,
      hint: `k${index}00`,
      rotationOrder: index + 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    secrets.set(`citefox.serpapi.${keyId}`, `secret-${keyId}`)
  }
  const calls: string[] = []
  let sequence = 0
  const host: PlaygroundHost = {
    storage,
    secrets,
    logger: createLogger({ write: () => undefined }),
    http: {
      async request(request) {
        const keyId = (new URL(request.url).searchParams.get('api_key') ?? '').replace(
          'secret-',
          ''
        )
        calls.push(keyId)
        return respond(keyId, request)
      }
    },
    now: () => new Date('2026-10-19T12:00:00.000Z'),
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    knownSecrets: () => ['secret-key-1', 'secret-key-2'],
    settings: () => storage.readSettings()
  }
  return { host, storage, calls }
}

function activeProject(storage: AppStorage, cap: number | null, dedicated: string | null): void {
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  writeProjectScheduleCap(db, { cap, capRule: 'pause', dedicatedKeyId: dedicated })
  closeProjectDatabase(db)
  writeActiveProjectId(storage.db, 'proj-1')
}

function request(prompts: string[]): PlaygroundAioRequest {
  return {
    url: PAGE,
    prompts,
    market: {
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false
    },
    runId: null
  }
}

const memory = { find: () => null }

function usageByKey(storage: AppStorage): Record<string, number> {
  const rows = storage.db
    .prepare<unknown[], { key_id: string; searches: number }>(
      'SELECT key_id, SUM(searches) AS searches FROM key_usage GROUP BY key_id ORDER BY key_id'
    )
    .all()
  return Object.fromEntries(rows.map((row) => [row.key_id, row.searches]))
}

describe('playground AI Overview check (shared capture and rotation)', () => {
  test('fails over like a check and charges each key for its own search', async () => {
    const { host, storage, calls } = setup((keyId) =>
      keyId === 'key-1'
        ? envelope('google-out-of-searches-429.json')
        : envelope('google-ai-overview.json')
    )
    const result = await checkPlaygroundAio(host, request(['How do I alert the crew?']), memory)
    expect(calls).toEqual(['key-1', 'key-2'])
    expect(result.prompts[0]).toMatchObject({
      ok: true,
      keyId: 'key-2',
      keyLabel: 'Key 2',
      cited: true,
      position: 2,
      reason: null
    })
    expect(result.prompts[0]?.summary).toContain('How to Set Up Text Alerts for Business')
    expect(usageByKey(storage)).toEqual({ 'key-1': 1, 'key-2': 1 })
  })

  test('counts every retry and follow-up like a check', async () => {
    const { host, storage } = setup((_keyId, req) =>
      new URL(req.url).searchParams.get('engine') === 'google_ai_overview'
        ? envelope('google-ai-overview.json')
        : envelope('google-page-token.json')
    )
    const result = await checkPlaygroundAio(host, request(['How do I alert the crew?']), memory)
    expect(result.prompts[0]?.ok).toBe(true)
    expect(usageByKey(storage)).toEqual({ 'key-1': 2 })
  })

  test("respects the active project's cap and dedicated key", async () => {
    const capped = setup(() => envelope('google-ai-overview.json'))
    activeProject(capped.storage, 0, null)
    const blocked = await checkPlaygroundAio(capped.host, request(['How?']), memory)
    expect(capped.calls).toEqual([])
    expect(blocked.prompts[0]).toMatchObject({ ok: false, reason: 'other', keyId: null })
    expect(blocked.prompts[0]?.message).toMatch(/search cap/)

    const dedicated = setup(() => envelope('google-ai-overview.json'))
    activeProject(dedicated.storage, null, 'key-2')
    const checked = await checkPlaygroundAio(dedicated.host, request(['How?']), memory)
    expect(dedicated.calls).toEqual(['key-2'])
    expect(checked.prompts[0]?.keyId).toBe('key-2')
  })

  test('an empty follow-up is an error, not an overview that cites nothing', async () => {
    const { host } = setup((_keyId, req) =>
      new URL(req.url).searchParams.get('engine') === 'google_ai_overview'
        ? { status: 200, body: JSON.stringify({ search_metadata: {} }) }
        : envelope('google-page-token.json')
    )
    const result = await checkPlaygroundAio(host, request(['How?']), memory)
    expect(result.prompts[0]).toMatchObject({ ok: false, reason: 'other', cited: null })
    expect(result.prompts[0]?.message).toBe('The AI Overview follow-up came back empty.')
  })
})
