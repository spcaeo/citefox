import { afterEach, describe, expect, test } from 'vitest'
import type { SerpApiRotationMode } from '@shared/domain'
import type { HttpRequest } from '../../providers/http'
import { writeProjectScheduleCap } from '../../storage/project-schedule'
import { addKeyUsage, getApiKey, updateApiKey } from '../../storage/records'
import { monthKey } from '../../scheduler/local-time'
import { capNextStep, capResetLabel } from './cap-copy'
import { closeSeeds, envelope, NOW, SECRET, seed, timeZone } from './checks.test-helper'

afterEach(() => {
  closeSeeds()
})

function keyOf(request: HttpRequest): string {
  const secret = new URL(request.url).searchParams.get('api_key') ?? ''
  if (secret === SECRET) return 'key-1'
  return secret.startsWith(`${SECRET}-`) ? secret.slice(SECRET.length + 1) : 'unknown'
}

function engineOf(request: HttpRequest): string {
  return new URL(request.url).searchParams.get('engine') ?? ''
}

type Seeded = Awaited<ReturnType<typeof seed>>

function setRotation(storage: Seeded['storage'], mode: SerpApiRotationMode): void {
  storage.writeSettings({ ...storage.readSettings(), serpapiRotation: mode })
}

function start(handlers: Seeded['handlers']): ReturnType<Seeded['handlers']['checks:start']> {
  return handlers['checks:start']({
    projectId: 'proj-1',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null
  })
}

describe('SerpApi rotation modes (FR-11.2)', () => {
  test('in order uses the first key with room for every search', async () => {
    const calls: string[] = []
    const { handlers } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2'],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    expect((await start(handlers)).status).toBe('finished')
    expect(calls).toEqual(['key-1', 'key-1'])
  })

  test('spread evenly moves to the next key on every search, across jobs', async () => {
    const calls: string[] = []
    const { handlers, storage } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2', 'key-3'],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    setRotation(storage, 'spread_evenly')
    expect((await start(handlers)).status).toBe('finished')
    expect(calls).toEqual(['key-1', 'key-2'])
    expect((await start(handlers)).status).toBe('finished')
    expect(calls).toEqual(['key-1', 'key-2', 'key-3', 'key-1'])
  })

  test('the AI Overview follow-up always uses the key that made the search (FR-11.3)', async () => {
    const calls: string[] = []
    const { handlers, storage } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2'],
      http(request) {
        calls.push(`${engineOf(request)}:${keyOf(request)}`)
        return engineOf(request) === 'google'
          ? envelope('google-page-token.json')
          : envelope('google-ai-overview.json')
      }
    })
    setRotation(storage, 'spread_evenly')
    expect((await start(handlers)).status).toBe('finished')
    expect(calls).toEqual([
      'google:key-1',
      'google_ai_overview:key-1',
      'google:key-2',
      'google_ai_overview:key-2'
    ])
  })

  test('project keys uses only keys assigned to the project', async () => {
    const calls: string[] = []
    const { handlers, storage } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2', 'key-3'],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    const assigned = getApiKey(storage.db, 'key-3')
    if (assigned === null) throw new Error('missing key')
    updateApiKey(storage.db, { ...assigned, projectIds: ['proj-1'] })
    setRotation(storage, 'project_keys')
    expect((await start(handlers)).status).toBe('finished')
    expect(calls).toEqual(['key-3', 'key-3'])
  })

  test('project keys with no assigned key asks for one before any search', async () => {
    const calls: string[] = []
    const { handlers, storage } = await seed({
      progress: [],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    setRotation(storage, 'project_keys')
    const job = await start(handlers)
    expect(job.status).toBe('error')
    expect(calls).toEqual([])
  })

  test('a dedicated key is the whole pool, even when spreading', async () => {
    const calls: string[] = []
    const { handlers, storage, projectDb } = await seed({
      progress: [],
      secondPrompt: true,
      extraKeys: ['key-2', 'key-3'],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    setRotation(storage, 'spread_evenly')
    writeProjectScheduleCap(projectDb, { cap: null, capRule: 'pause', dedicatedKeyId: 'key-2' })
    expect((await start(handlers)).status).toBe('finished')
    expect(calls).toEqual(['key-2', 'key-2'])
  })

  test('each capture is recorded as a timestamped search for the last 24 hours', async () => {
    const { handlers, storage } = await seed({
      progress: [],
      secondPrompt: true,
      http: () => envelope('google-ai-overview.json')
    })
    expect((await start(handlers)).status).toBe('finished')
    const rows = storage.db
      .prepare<unknown[], { total: number }>(
        `SELECT SUM(count) AS total FROM activity_events WHERE kind = 'search' AND project_id = 'proj-1'`
      )
      .get()
    expect(rows?.total).toBe(2)
  })
})

describe('project cap rules (FR-11.4)', () => {
  test('the reset day is the 1st of next month', () => {
    expect(capResetLabel('2026-10')).toBe('Nov 1')
    expect(capResetLabel('2026-12')).toBe('Jan 1')
    expect(capNextStep('pause', '2026-10')).toBe(
      'Checks for this project pause until the cap resets on Nov 1. Raise the cap in Project settings to check now.'
    )
    expect(capNextStep('notify', '2026-10')).toContain('CiteFox is waiting for you.')
    expect(capNextStep('allow_10', '2026-10')).toContain('This includes the 10% extra.')
  })

  test.each([
    ['notify', 'CiteFox is waiting for you.'],
    ['allow_10', 'This includes the 10% extra.']
  ] as const)('a check stopped at the cap says what %s does', async (capRule, words) => {
    const calls: string[] = []
    const { handlers, projectDb } = await seed({
      progress: [],
      http(request) {
        calls.push(keyOf(request))
        return envelope('google-ai-overview.json')
      }
    })
    writeProjectScheduleCap(projectDb, { cap: 0, capRule, dedicatedKeyId: null })
    const job = await start(handlers)
    expect(job.status).toBe('error')
    expect(job.message).toBe("This check would pass the project's search cap.")
    expect(job.nextStep).toContain(words)
    expect(calls).toEqual([])
  })

  test('allow 10% over admits floor(cap / 10) more searches than pause', async () => {
    const month = monthKey(Date.parse(NOW), timeZone())
    const run = async (capRule: 'pause' | 'allow_10'): Promise<string> => {
      const { handlers, projectDb, storage } = await seed({
        progress: [],
        secondPrompt: true,
        http: () => envelope('google-ai-overview.json')
      })
      addKeyUsage(storage.db, {
        id: `usage-${capRule}`,
        keyId: 'key-1',
        projectId: 'proj-1',
        month,
        searches: 7,
        calls: 7,
        tokens: 0
      })
      // Two prompts can need up to four searches: 7 + 4 = 11.
      writeProjectScheduleCap(projectDb, { cap: 10, capRule, dedicatedKeyId: null })
      return (await start(handlers)).status
    }
    expect(await run('pause')).toBe('error')
    expect(await run('allow_10')).toBe('finished')
  })
})
