import { afterEach, describe, expect, test } from 'vitest'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import { getApiKey, listApiKeys, updateApiKey } from '../../storage/records'
import {
  listStoredSerpResults,
  sumStoredJobSearches,
  type StoredSerpResult
} from '../../storage/check-records'
import { closeSeeds, envelope, runFilter, SECRET, seed } from './checks.test-helper'
import { keyRoom } from './key-rotation'

afterEach(() => {
  closeSeeds()
})

const KEY_2_SECRET = `${SECRET}-key-2`

function keyOf(request: HttpRequest): string {
  const secret = new URL(request.url).searchParams.get('api_key')
  if (secret === SECRET) return 'key-1'
  if (secret === KEY_2_SECRET) return 'key-2'
  return 'unknown'
}

function start(
  handlers: Awaited<ReturnType<typeof seed>>['handlers']
): ReturnType<(typeof handlers)['checks:start']> {
  return handlers['checks:start']({
    projectId: 'proj-1',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null
  })
}

function searchesByKey(
  storage: Awaited<ReturnType<typeof seed>>['storage']
): Record<string, number> {
  const rows = storage.db
    .prepare<unknown[], { key_id: string; searches: number }>(
      'SELECT key_id, SUM(searches) AS searches FROM key_usage GROUP BY key_id ORDER BY key_id'
    )
    .all()
  return Object.fromEntries(rows.map((row) => [row.key_id, row.searches]))
}

function serpRows(projectDb: Awaited<ReturnType<typeof seed>>['projectDb']): StoredSerpResult[] {
  return listStoredSerpResults(projectDb, runFilter())
}

describe('SerpApi key rotation in a check (FR-11.3, SERP-6)', () => {
  test('a 429 out-of-searches fails over once and every search adds up', async () => {
    const calls: string[] = []
    const { handlers, projectDb, storage, checkEngine } = await seed({
      progress: [],
      extraKeys: ['key-2'],
      sleep: async () => undefined,
      http(request) {
        calls.push(keyOf(request))
        return keyOf(request) === 'key-1'
          ? envelope('google-out-of-searches-429.json')
          : envelope('google-ai-overview.json')
      }
    })
    const job = await start(handlers)
    expect(job.status).toBe('finished')
    expect(calls).toEqual(['key-1', 'key-2'])
    const [row] = serpRows(projectDb)
    expect(row).toMatchObject({ keyId: 'key-2', searches: 2, status: 'page_cited' })
    expect(job.searchesUsed).toBe(2)
    expect(sumStoredJobSearches(projectDb, job.id)).toBe(2)
    expect(checkEngine.searchesFor(job.id)).toHaveLength(2)
    expect(searchesByKey(storage)).toEqual({ 'key-1': 1, 'key-2': 1 })
  })

  test('a key out of searches is not tried again for the rest of the job', async () => {
    const calls: string[] = []
    const { handlers, projectDb } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2'],
      sleep: async () => undefined,
      http(request) {
        calls.push(keyOf(request))
        return keyOf(request) === 'key-1'
          ? envelope('google-out-of-searches.json')
          : envelope('google-ai-overview.json')
      }
    })
    const job = await start(handlers)
    expect(job.status).toBe('finished')
    expect(calls).toEqual(['key-1', 'key-2', 'key-2'])
    expect(serpRows(projectDb).map((row) => [row.keyId, row.searches])).toEqual([
      ['key-2', 2],
      ['key-2', 1]
    ])
  })

  test('the one failover retry does not move on to a third key', async () => {
    const calls: string[] = []
    const { handlers, projectDb } = await seed({
      progress: [],
      extraKeys: ['key-2', 'key-3'],
      sleep: async () => undefined,
      http(request) {
        const secret = new URL(request.url).searchParams.get('api_key')
        calls.push(secret === `${SECRET}-key-3` ? 'key-3' : keyOf(request))
        return secret === `${SECRET}-key-3`
          ? envelope('google-ai-overview.json')
          : envelope('google-invalid-key.json')
      }
    })
    const job = await start(handlers)
    expect(job.status).toBe('finished')
    expect(calls).toEqual(['key-1', 'key-2'])
    expect(serpRows(projectDb)[0]).toMatchObject({
      keyId: 'key-2',
      searches: 2,
      status: 'error',
      errorCode: 'rejected'
    })
  })

  test('a long Retry-After moves on at once and rests that key for the next prompt', async () => {
    const calls: string[] = []
    const waits: number[] = []
    const { handlers, projectDb } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2'],
      sleep: async (ms) => {
        waits.push(ms)
      },
      http(request): HttpResponse {
        calls.push(keyOf(request))
        return keyOf(request) === 'key-1'
          ? { ...envelope('google-rate-limited.json'), headers: { 'retry-after': '3600' } }
          : envelope('google-ai-overview.json')
      }
    })
    const job = await start(handlers)
    expect(job.status).toBe('finished')
    expect(waits).toEqual([])
    expect(calls).toEqual(['key-1', 'key-2', 'key-2'])
    expect(serpRows(projectDb)[0]).toMatchObject({ keyId: 'key-2', searches: 2 })
  })

  test('a key switched off during a job is not used for later samples', async () => {
    const calls: string[] = []
    const { handlers, storage } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2'],
      http(request) {
        calls.push(keyOf(request))
        const key = getApiKey(storage.db, 'key-1')
        if (key !== null && key.on) updateApiKey(storage.db, { ...key, on: false })
        return envelope('google-ai-overview.json')
      }
    })
    const job = await start(handlers)
    expect(job.status).toBe('finished')
    expect(calls).toEqual(['key-1', 'key-2'])
  })

  test('a key at its plan allowance is skipped even when its CiteFox cap is higher', async () => {
    const calls: string[] = []
    const { handlers, storage } = await seed({
      progress: [],
      extraKeys: ['key-2'],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    const key = listApiKeys(storage.db).find((item) => item.id === 'key-1')
    if (key === undefined) throw new Error('missing key-1')
    updateApiKey(storage.db, {
      ...key,
      cap: 500,
      serpapiUsage: { used: 100, planLimit: 100, plan: 'Developer' }
    })
    const job = await start(handlers)
    expect(job.status).toBe('finished')
    expect(calls).toEqual(['key-2'])
  })

  test('every key out of room stops the job without sending a search', async () => {
    const calls: string[] = []
    const { handlers, storage } = await seed({
      progress: [],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    const key = listApiKeys(storage.db).find((item) => item.id === 'key-1')
    if (key === undefined) throw new Error('missing key-1')
    updateApiKey(storage.db, { ...key, cap: 0 })
    const job = await start(handlers)
    expect(calls).toEqual([])
    expect(job).toMatchObject({
      status: 'error',
      message: 'Your searches for this period are used up.'
    })
  })
})

describe('keyRoom', () => {
  const base = {
    keyId: 'k',
    name: 'k',
    provider: 'serpapi' as const,
    state: 'ok' as const,
    rotationOrder: 1,
    projectIds: [],
    cap: null,
    planLimit: null,
    planUsed: null
  }

  test('uses the lower of the CiteFox cap and the plan allowance, like Connections', () => {
    expect(keyRoom({ ...base, cap: 500, planLimit: 100 }, 40)).toBe(60)
    expect(keyRoom({ ...base, cap: 50, planLimit: 100 }, 40)).toBe(10)
    expect(keyRoom({ ...base, cap: null, planLimit: null }, 40)).toBe(Number.MAX_SAFE_INTEGER)
    expect(keyRoom({ ...base, cap: 0 }, 0)).toBe(0)
  })

  test('takes SerpApi plan usage when it is above the CiteFox count', () => {
    expect(keyRoom({ ...base, planLimit: 100, planUsed: 90 }, 5)).toBe(10)
    expect(keyRoom({ ...base, planLimit: 100, planUsed: 2 }, 5)).toBe(95)
  })
})
