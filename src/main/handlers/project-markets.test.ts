import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { setPageMarketBaselineRunId, setPageMarketLastCheckedAt } from '../storage/pages'
import type { PageDetail } from '@shared/ipc'
import { createIpcHandlers } from './index'

/**
 * Page settings (`pages:update` label, URL, interval, samples, default market,
 * status; remove and restore) and Project settings › Markets
 * (`projectSettings:markets`, `addMarket`, `removeMarket`, `restoreMarket`,
 * `setDefaultMarket`) on a real project database.
 */

const directories: string[] = []
const closers: (() => void)[] = []
const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const UK = { country: 'GB', language: 'en', location: null, device: 'desktop', localWording: false }
const CA = { country: 'CA', language: 'en', location: null, device: 'desktop', localWording: false }

function harness(): { handlers: ReturnType<typeof createIpcHandlers>; storage: AppStorage } {
  globalThis.fetch = (() => {
    throw new Error('network')
  }) as typeof fetch
  const directory = mkdtempSync(join(tmpdir(), 'citefox-markets-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  const registry = new SecretRegistry()
  let clock = Date.parse('2026-10-19T12:00:00.000Z')
  let sequence = 0
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets: new MemorySecretStore(registry),
    logger: createLogger({ write: () => undefined, secrets: () => registry.list() }),
    http: {
      async request() {
        return { status: 500, body: '' }
      }
    },
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    emitPageReadProgress: () => undefined,
    emitFillProgress: () => undefined,
    knownSecrets: () => registry.list(),
    now: () => {
      const current = new Date(clock)
      clock += 1000
      return current
    },
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    pageDns: {
      async lookup() {
        return ['93.184.216.34']
      }
    }
  })
  return { handlers, storage }
}

async function seed(handlers: ReturnType<typeof createIpcHandlers>): Promise<{
  projectId: string
  slug: string
  us: string
  alerts: string
  pricing: string
}> {
  const project = await handlers['projects:create']({
    name: 'TextBolt',
    domain: 'textbolt.com',
    includeSubdomains: true,
    brandNames: ['TextBolt'],
    competitors: [],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop'
  })
  const page = (url: string, markets: (typeof UK)[]): Promise<PageDetail> | PageDetail =>
    handlers['pages:add']({
      projectId: project.id,
      url,
      markets: markets as never,
      intervalDays: 14,
      samples: 1,
      promptCount: 10
    })
  const alerts = await page('https://textbolt.com/alerts', [])
  const pricing = await page('https://textbolt.com/pricing', [])
  const us = project.defaultMarket?.id
  if (!us) throw new Error('no default market')
  return { projectId: project.id, slug: project.slug, us, alerts: alerts.id, pricing: pricing.id }
}

describe('page settings through pages:update', () => {
  test('saves label, URL, interval, samples and default market; pause and restore after remove', async () => {
    const { handlers } = harness()
    const { projectId, alerts, us } = await seed(handlers)
    const withUk = await handlers['pages:update']({
      projectId,
      pageId: alerts,
      markets: [
        { country: 'US', language: 'en', location: null, device: 'desktop', localWording: false },
        UK as never
      ]
    })
    const uk = withUk.markets.find((market) => market.country === 'GB')?.id ?? ''
    expect(withUk.defaultMarketId).toBe(us)

    const saved = await handlers['pages:update']({
      projectId,
      pageId: alerts,
      label: 'Text alerts',
      url: 'https://textbolt.com/text-alerts',
      intervalDays: 30,
      samples: 3,
      defaultMarketId: uk
    })
    expect(saved).toMatchObject({
      label: 'Text alerts',
      url: 'https://textbolt.com/text-alerts',
      intervalDays: 30,
      samples: 3,
      defaultMarketId: uk
    })
    const read = await handlers['pages:get']({ projectId, pageId: alerts })
    expect(read).toMatchObject({ label: 'Text alerts', intervalDays: 30, samples: 3 })

    await expect(
      handlers['pages:update']({ projectId, pageId: alerts, intervalDays: 21 as never })
    ).rejects.toThrow('pages:update: Invalid request')

    expect(
      (await handlers['pages:update']({ projectId, pageId: alerts, status: 'paused' })).status
    ).toBe('paused')
    await handlers['pages:remove']({ projectId, pageId: alerts })
    expect((await handlers['pages:list']({ projectId })).pages.map((p) => p.id)).not.toContain(
      alerts
    )
    // Undo of a remove: the status before it comes back.
    const restored = await handlers['pages:update']({ projectId, pageId: alerts, status: 'paused' })
    expect(restored.status).toBe('paused')
    expect((await handlers['pages:list']({ projectId })).pages.map((p) => p.id)).toContain(alerts)
  })
})

describe('Project settings › Markets', () => {
  test('lists markets with their pages, adds one to some pages, and makes it the default', async () => {
    const { handlers } = harness()
    const { projectId, alerts, pricing, us } = await seed(handlers)
    const view = await handlers['projectSettings:markets']({ projectId })
    expect(view.defaultMarketId).toBe(us)
    expect(view.markets.map((market) => market.id)).toEqual([us])
    expect(view.pages.map((page) => [page.id, page.marketIds])).toEqual([
      [alerts, [us]],
      [pricing, [us]]
    ])

    const added = await handlers['projectSettings:addMarket']({
      projectId,
      market: UK as never,
      pageIds: [alerts]
    })
    expect(added.added).toEqual([alerts])
    expect(added.view.markets).toHaveLength(2)
    const again = await handlers['projectSettings:addMarket']({
      projectId,
      market: UK as never,
      pageIds: [alerts, pricing]
    })
    expect(again.marketId).toBe(added.marketId)
    expect(again.alreadyHad).toEqual([alerts])
    expect(again.added).toEqual([pricing])

    const made = await handlers['projectSettings:setDefaultMarket']({
      projectId,
      marketId: added.marketId,
      pages: 'tracking'
    })
    expect(made.previousDefaultMarketId).toBe(us)
    expect(made.changedPages).toEqual([
      { pageId: alerts, previousMarketId: us },
      { pageId: pricing, previousMarketId: us }
    ])
    expect(made.view.defaultMarketId).toBe(added.marketId)
    expect((await handlers['projects:get']({ projectId })).defaultMarket?.country).toBe('GB')
    // US stays a market of both pages, and its row is unchanged.
    expect(made.view.markets.find((market) => market.id === us)?.country).toBe('US')

    await expect(
      handlers['projectSettings:addMarket']({ projectId, market: CA as never, pageIds: [] })
    ).rejects.toThrow('projectSettings:addMarket: Invalid request')
    await expect(
      handlers['projectSettings:addMarket']({
        projectId,
        market: CA as never,
        pageIds: ['page-missing']
      })
    ).rejects.toThrow('That page was not found')
  })

  test('removes a market from every page with Undo, keeping baselines; never the default', async () => {
    const { handlers, storage } = harness()
    const { projectId, slug, alerts, pricing, us } = await seed(handlers)
    const added = await handlers['projectSettings:addMarket']({
      projectId,
      market: UK as never,
      pageIds: [alerts, pricing]
    })
    const uk = added.marketId
    await handlers['pages:update']({ projectId, pageId: alerts, defaultMarketId: uk })
    await handlers['pages:update']({
      projectId,
      pageId: pricing,
      markets: [UK as never]
    })
    const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
    try {
      setPageMarketBaselineRunId(db, alerts, uk, 'run-uk-1')
      setPageMarketLastCheckedAt(db, alerts, uk, '2026-10-18T09:00:00.000Z')
    } finally {
      closeProjectDatabase(db)
    }

    await expect(
      handlers['projectSettings:removeMarket']({ projectId, marketId: us })
    ).rejects.toThrow(/default market for new pages/)

    const removed = await handlers['projectSettings:removeMarket']({ projectId, marketId: uk })
    expect(removed.skipped).toEqual([pricing])
    expect(removed.removed).toEqual([
      {
        pageId: alerts,
        addedAt: expect.any(String) as string,
        baselineRunId: 'run-uk-1',
        lastCheckedAt: '2026-10-18T09:00:00.000Z',
        wasDefault: true
      }
    ])
    const after = await handlers['pages:get']({ projectId, pageId: alerts })
    expect(after.markets.map((market) => market.id)).toEqual([us])
    expect(after.defaultMarketId).toBe(us)

    const back = await handlers['projectSettings:restoreMarket']({
      projectId,
      marketId: uk,
      links: removed.removed
    })
    expect(back.pages.find((page) => page.id === alerts)?.marketIds).toEqual([us, uk])
    expect(back.pages.find((page) => page.id === alerts)?.defaultMarketId).toBe(uk)
    const check = openProjectDatabase(storage.paths.projectsDirectory, slug)
    try {
      const row = check
        .prepare<unknown[], { baseline_run_id: string | null; last_checked_at: string | null }>(
          `SELECT baseline_run_id, last_checked_at FROM page_markets WHERE page_id = ? AND market_id = ?`
        )
        .get(alerts, uk)
      expect(row).toEqual({
        baseline_run_id: 'run-uk-1',
        last_checked_at: '2026-10-18T09:00:00.000Z'
      })
    } finally {
      closeProjectDatabase(check)
    }
  })
})
