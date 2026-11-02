import { afterEach, describe, expect, test } from 'vitest'
import { createSetupRunner } from '../setup-runner/runner'
import {
  cleanupRunnerHarness,
  HOUR,
  manualTimers,
  runnerHarness
} from '../setup-runner/runner.test-helper'
import { getPage } from '../storage/pages'
import { createMapTransport, fixtureDns } from '../structure/fixture-transport'
import { textboltSitemapFixture } from '../structure/fixtures/textbolt-sitemaps'
import { createStructureRuntime } from '../structure/runtime'
import { dueSyncProjects } from '../structure/sync-loop'
import { CHECK_DUE_EXIT_OK } from './check-due'
import { runBackgroundPass } from './background-pass'
import { runCheckDueCommand } from './storage-pass'

afterEach(() => {
  cleanupRunnerHarness()
})

describe('--check-due background work', () => {
  test('runs after the checks; a failure is logged and keeps exit 0; a hand-off skips it', async () => {
    const order: string[] = []
    const errors: string[] = []
    const logger = {
      error: (message: string) => {
        errors.push(message)
      }
    }
    expect(
      await runCheckDueCommand({
        logger,
        background: async () => {
          order.push('background')
        }
      })
    ).toBe(CHECK_DUE_EXIT_OK)
    expect(order).toEqual(['background'])
    expect(
      await runCheckDueCommand({
        logger,
        background: async () => {
          throw new Error('sync failed')
        }
      })
    ).toBe(CHECK_DUE_EXIT_OK)
    expect(errors).toEqual(['Background setup failed'])
    await runCheckDueCommand({
      logger,
      shouldStop: () => true,
      background: async () => {
        order.push('handoff')
      }
    })
    expect(order).toEqual(['background'])
  })

  test('syncs due sitemaps, then sets up pages, inside the budget', async () => {
    const sitemapFetch = {
      http: createMapTransport(textboltSitemapFixture('base').files),
      dns: fixtureDns
    }
    const h = await runnerHarness({ sitemapFetch })
    await h.handlers['sitemaps:discover']({ projectId: h.projectId, url: null })
    await h.handlers['sitemaps:setRules']({
      projectId: h.projectId,
      rules: {
        frequency: 'daily',
        onNew: 'add_untracked',
        onRemoved: 'pause',
        onChanged: 'nothing'
      }
    })
    const [pageId] = await h.addPages(1)
    h.clock.now += 25 * HOUR
    expect(dueSyncProjects(h.host, new Date(h.clock.now))).toEqual([h.projectId])
    const structure = createStructureRuntime(h.host, {
      sitemapFetch,
      reread: async () => undefined
    })
    const runner = createSetupRunner({
      host: h.host,
      timers: manualTimers(),
      timeZone: () => 'UTC'
    })

    // No budget left: nothing starts.
    const none = await runBackgroundPass({
      host: h.host,
      runner,
      structure,
      now: () => h.clock.now,
      budgetMs: 0
    })
    expect(none).toEqual({ syncedProjects: [], skippedProjects: [h.projectId] })
    expect(getPage(h.db(), pageId ?? '', h.projectId)?.status).toBe('setting_up')

    const done = await runBackgroundPass({
      host: h.host,
      runner,
      structure,
      now: () => h.clock.now,
      budgetMs: 2 * 60_000
    })
    expect(done.syncedProjects).toEqual([h.projectId])
    expect((await h.handlers['sitemaps:get']({ projectId: h.projectId })).lastSync?.trigger).toBe(
      'scheduled'
    )
    expect(dueSyncProjects(h.host, new Date(h.clock.now))).toEqual([])
    expect(getPage(h.db(), pageId ?? '', h.projectId)?.status).toBe('tracked')
    runner.stop()
  })
})
