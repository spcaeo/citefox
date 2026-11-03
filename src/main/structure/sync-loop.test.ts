import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness, harness } from '../handlers/test-harness'
import type { EngineHost } from '../engine/host'
import { createMapTransport, fixtureDns } from './fixture-transport'
import { textboltSitemapFixture } from './fixtures/textbolt-sitemaps'
import {
  dueSyncProjects,
  e2eSitemapFetch,
  FIRST_TICK_MS,
  startSitemapSyncLoop,
  structureRuntimeFor,
  SYNC_TICK_MS
} from './sync-loop'

afterEach(cleanupHarness)

describe('scheduled sitemap sync (FR-19.2)', () => {
  test('a daily project is due a day after its last sync, and the loop syncs it once', async () => {
    let host: EngineHost | undefined
    let clock = Date.parse('2026-10-19T12:00:00.000Z')
    const h = harness({
      sitemapFetch: {
        http: createMapTransport(textboltSitemapFixture('base').files),
        dns: fixtureDns
      },
      onHost: (opened) => {
        host = opened
      },
      now: () => new Date(clock)
    })
    if (host === undefined) throw new Error('host missing')
    const project = await h.handlers['projects:create']({
      name: 'TextBolt',
      domain: 'textbolt.com',
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: [],
      clientName: null,
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop'
    })
    expect(dueSyncProjects(host, new Date(clock))).toEqual([])
    await h.handlers['sitemaps:discover']({ projectId: project.id, url: null })
    await h.handlers['sitemaps:setRules']({
      projectId: project.id,
      rules: { frequency: 'daily', onNew: 'add_untracked', onRemoved: 'pause', onChanged: 'reread' }
    })
    expect(dueSyncProjects(host, new Date(clock))).toEqual([])
    clock += 25 * 3_600_000
    expect(dueSyncProjects(host, new Date(clock))).toEqual([project.id])

    const scheduled: Array<{ run: () => void; ms: number }> = []
    const runtime = structureRuntimeFor(host)
    const stop = startSitemapSyncLoop(runtime, {
      set: (run, ms) => {
        scheduled.push({ run, ms })
        return scheduled.length
      },
      clear: () => undefined
    })
    expect(scheduled[0]?.ms).toBe(FIRST_TICK_MS)
    scheduled[0]?.run()
    await new Promise((resolve) => setTimeout(resolve, 50))
    for (let i = 0; i < 20 && scheduled.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(scheduled[1]?.ms).toBe(SYNC_TICK_MS)
    const overview = await h.handlers['sitemaps:get']({ projectId: project.id })
    expect(overview.lastSync?.trigger).toBe('scheduled')
    expect(dueSyncProjects(host, new Date(clock))).toEqual([])
    stop()
  })

  test('a failure while reading what is due is logged and the next tick is still planned', async () => {
    const warnings: string[] = []
    const runtime = {
      host: {
        now: () => {
          throw new Error('clock broke')
        },
        logger: { warn: (message: string) => warnings.push(message) }
      },
      sync: async () => undefined
    } as unknown as Parameters<typeof startSitemapSyncLoop>[0]
    const scheduled: Array<{ run: () => void; ms: number }> = []
    const stop = startSitemapSyncLoop(runtime, {
      set: (run, ms) => {
        scheduled.push({ run, ms })
        return scheduled.length
      },
      clear: () => undefined
    })
    scheduled[0]?.run()
    for (let i = 0; i < 20 && scheduled.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(warnings).toEqual(['scheduled sitemap sync could not start'])
    expect(scheduled[1]?.ms).toBe(SYNC_TICK_MS)
    stop()
  })

  test('the e2e sitemap folder is honoured only in unpackaged builds', () => {
    expect(e2eSitemapFetch(true, { CITEFOX_E2E_SITEMAP_DIR: '/tmp/x' })).toBeUndefined()
    expect(e2eSitemapFetch(false, {})).toBeUndefined()
    expect(e2eSitemapFetch(false, { CITEFOX_E2E_SITEMAP_DIR: '/tmp/x' })?.dns).toBe(fixtureDns)
  })
})
