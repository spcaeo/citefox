import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createIpcHandlers } from '../../handlers'
import { matchSerpApiLocation } from '../../locations'
import { createLogger } from '../../logging/logger'
import { MemorySecretStore } from '../../secrets/secret-store'
import { openAppStorage } from '../../storage/app-storage'
import { SERPAPI_LOCATIONS } from './locations'

const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('SerpApi location catalogue (FR-9.5)', () => {
  test('matches a city by name or "City, Region", case-insensitively', () => {
    expect(matchSerpApiLocation('Austin', 'US', SERPAPI_LOCATIONS)).toBe(
      'Austin,Texas,United States'
    )
    expect(matchSerpApiLocation('austin, texas', 'US', SERPAPI_LOCATIONS)).toBe(
      'Austin,Texas,United States'
    )
    expect(matchSerpApiLocation('Toronto', 'CA', SERPAPI_LOCATIONS)).toBe('Toronto,Ontario,Canada')
  })

  test('lists UK cities under both UK and GB, and only in their own country', () => {
    expect(matchSerpApiLocation('London', 'UK', SERPAPI_LOCATIONS)).toBe(
      'London,England,United Kingdom'
    )
    expect(matchSerpApiLocation('London', 'GB', SERPAPI_LOCATIONS)).toBe(
      'London,England,United Kingdom'
    )
    expect(matchSerpApiLocation('London', 'US', SERPAPI_LOCATIONS)).toBeNull()
    expect(matchSerpApiLocation('Atlantis', 'US', SERPAPI_LOCATIONS)).toBeNull()
  })

  test('every entry has a unique query per country and a three-part canonical name', () => {
    const keys = SERPAPI_LOCATIONS.map((entry) => `${entry.country}|${entry.query.toLowerCase()}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const entry of SERPAPI_LOCATIONS) {
      expect(entry.canonicalName.split(',')).toHaveLength(3)
    }
  })

  test('production handlers match a market city without an injected catalogue', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'citefox-locations-'))
    const storage = openAppStorage(directory)
    closers.push(() => storage.close())
    const handlers = createIpcHandlers({
      appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
      storage,
      secrets: new MemorySecretStore(),
      logger: createLogger({ write: () => undefined }),
      http: {
        async request() {
          throw new Error('no network in this test')
        }
      },
      claudeCommand: {
        async run() {
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
        }
      },
      claudeProbe: { exists: () => false, searchPath: () => null },
      emitCheckupProgress: () => undefined,
      emit: () => undefined
    })
    const state = await handlers['onboarding:saveProfile']({
      userName: 'Ada',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      includeSubdomains: true,
      brandNames: ['TextBolt'],
      competitors: [],
      country: 'US',
      language: 'en',
      location: 'Austin',
      device: 'desktop'
    })
    expect(state.profile?.defaultMarket.serpapiLocation).toBe('Austin,Texas,United States')
  })
})
