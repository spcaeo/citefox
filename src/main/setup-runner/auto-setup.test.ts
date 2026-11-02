import { afterEach, describe, expect, test } from 'vitest'
import { readProjectCheckSlice } from '../headless/check-catalog'
import { firstCheckWaits, pageCheckWhenReady } from '../storage/first-check-waits'
import { getPageSetupJob } from '../storage/page-setup-jobs'
import { getPage } from '../storage/pages'
import { getProject } from '../storage/records'
import { MAX_SETUP_ATTEMPTS } from './constants'
import { createSetupRunner } from './runner'
import {
  cleanupRunnerHarness,
  flush,
  runnerHarness,
  type RunnerHarness
} from './runner.test-helper'

afterEach(() => {
  cleanupRunnerHarness()
})

/** Starts the loop the way the window does, then lets the kicked page run. */
async function live(): Promise<RunnerHarness> {
  const h = await runnerHarness()
  h.runner.start()
  return h
}

async function addOne(
  h: RunnerHarness,
  url = 'https://textbolt.com/blog/alerts/'
): Promise<string> {
  const page = await h.handlers['pages:add']({
    projectId: h.projectId,
    url,
    markets: [],
    intervalDays: 14,
    samples: 1,
    promptCount: 10
  })
  return page.id
}

function searches(h: RunnerHarness): string[] {
  return h.http.requests.filter((url) => url.includes('serpapi.com'))
}

describe('automatic page setup (owner feedback 5)', () => {
  test('a single add reads, writes the profile, prompts and content gaps by itself, without searches', async () => {
    const h = await live()
    const pageId = await addOne(h)
    // No tick needed: the add starts the page at once.
    expect(h.runner.status().running).toBe(1)
    const running = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(running.state).toBe('running')
    await h.runner.idle()

    expect(getPage(h.db(), pageId, h.projectId)).toMatchObject({
      status: 'tracked',
      promptSetVersion: 1
    })
    expect(getPageSetupJob(h.db(), pageId)).toMatchObject({ state: 'done', lastError: null })
    expect(h.claude.calls).toHaveLength(6)
    expect(searches(h)).toEqual([])

    const ready = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(ready).toMatchObject({
      state: 'ready',
      firstCheckWaits: true,
      checkWhenReady: false,
      prompts: 10,
      markets: 1,
      searchesMin: 10,
      searchesMax: 20,
      action: null
    })
    expect(ready.steps.map((step) => `${step.id}:${step.state}`)).toEqual([
      'read:done',
      'profile:done',
      'prompts:done',
      'coverage:done',
      'ready:done'
    ])
    // The first check waits for the user: the scheduler leaves it alone.
    const project = getProject(h.storage.db, h.projectId)
    if (project === null) throw new Error('no project')
    const slice = readProjectCheckSlice(h.db(), project)
    expect(slice.pages.find((page) => page.pageId === pageId)?.firstCheckWaits).toBe(true)
    expect(h.firstChecks).toEqual([])
    // The page read and each Claude call pushed live steps for this page's panel.
    const steps = h.assistProgress.filter((event) => event.scope === pageId)
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.every((event) => event.channel === 'setup:run')).toBe(true)
    expect(steps.some((event) => event.kind === 'claude')).toBe(true)
    h.runner.stop()
  })

  test('check automatically when ready starts the first check once setup is done', async () => {
    const h = await live()
    expect(await h.handlers['setup:checkWhenReady']({ projectId: h.projectId, on: true })).toEqual({
      checkWhenReady: true
    })
    const pageId = await addOne(h)
    await h.runner.idle()
    expect(h.firstChecks).toEqual([{ projectId: h.projectId, pageId }])
    expect(firstCheckWaits(h.db(), pageId)).toBe(false)
    const view = await h.handlers['projectSettings:get']({ projectId: h.projectId })
    expect(view.checkWhenReady).toBe(true)
    h.runner.stop()
  })

  test('Add and check now starts that page’s first check once setup is done, and only that page', async () => {
    const h = await live()
    const page = await h.handlers['pages:add']({
      projectId: h.projectId,
      url: 'https://textbolt.com/blog/check-now/',
      markets: [],
      intervalDays: 14,
      samples: 1,
      promptCount: 10,
      checkWhenReady: true
    })
    const other = await addOne(h)
    await h.runner.idle()
    expect(h.firstChecks).toEqual([{ projectId: h.projectId, pageId: page.id }])
    expect(firstCheckWaits(h.db(), page.id)).toBe(false)
    expect(firstCheckWaits(h.db(), other)).toBe(true)
    await expect(
      h.handlers['pages:add']({
        projectId: h.projectId,
        url: 'https://textbolt.com/blog/bad/',
        markets: [],
        intervalDays: 14,
        samples: 1,
        promptCount: 10,
        checkWhenReady: 'yes'
      } as never)
    ).rejects.toThrow()
    h.runner.stop()
  })

  test('Add and check now survives a restart: pending on the page, then started once setup is ready', async () => {
    // The window closes before setup ran: the loop is not started, so the add only queues.
    const h = await runnerHarness()
    const page = await h.handlers['pages:add']({
      projectId: h.projectId,
      url: 'https://textbolt.com/blog/after-restart/',
      markets: [],
      intervalDays: 14,
      samples: 1,
      promptCount: 10,
      checkWhenReady: true
    })
    const other = await addOne(h)
    expect(pageCheckWhenReady(h.db(), page.id)).toBe(true)
    expect(pageCheckWhenReady(h.db(), other)).toBe(false)
    const pending = await h.handlers['setup:page']({ projectId: h.projectId, pageId: page.id })
    expect(pending).toMatchObject({ state: 'queued', checkAsked: true, firstCheckWaits: true })
    expect(pending.message).toContain('The first check you asked for starts when setup is ready.')
    expect(
      (await h.handlers['setup:page']({ projectId: h.projectId, pageId: other })).checkAsked
    ).toBe(false)
    h.runner.stop()

    // A new runner on the same storage (the next launch) knows nothing in memory.
    const firstChecks: Array<{ projectId: string; pageId: string }> = []
    const next = createSetupRunner({
      host: h.host,
      timers: h.timers,
      timeZone: () => 'UTC',
      startFirstCheck: (projectId, pageId) => firstChecks.push({ projectId, pageId })
    })
    await next.runFor(60_000)
    await next.idle()
    expect(firstChecks).toEqual([{ projectId: h.projectId, pageId: page.id }])
    expect(firstCheckWaits(h.db(), page.id)).toBe(false)
    expect(firstCheckWaits(h.db(), other)).toBe(true)
    const done = await h.handlers['setup:page']({ projectId: h.projectId, pageId: page.id })
    expect(done.checkAsked).toBe(false)
    expect(searches(h)).toEqual([])
    next.stop()
  })

  test('a failing read retries, then records one notice whose Retry starts the page again', async () => {
    const h = await live()
    h.http.readFails = true
    const pageId = await addOne(h)
    await h.runner.idle()
    let view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('retrying')
    expect(view.steps[0]).toMatchObject({ id: 'read', state: 'waiting' })
    expect(view.action).toEqual({ kind: 'retry', label: 'Retry now' })
    expect(view.retryAt).not.toBeNull()
    for (let attempt = 2; attempt <= MAX_SETUP_ATTEMPTS; attempt += 1) {
      h.clock.now += 5 * 60 * 60_000
      h.runner.pump()
      await h.runner.idle()
    }
    view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('failed')
    expect(view.steps[0]).toMatchObject({ id: 'read', state: 'failed' })
    expect(view.action).toEqual({ kind: 'retry', label: 'Retry' })
    const notices = await h.handlers['notices:list']()
    const notice = notices.notices.find((item) => item.kind === 'setup_failed')
    expect(notice?.title).toContain('Setup stopped for')
    expect(notice?.actions.find((action) => action.primary)?.label).toBe('Retry')
    expect(searches(h)).toEqual([])

    h.http.readFails = false
    await h.handlers['notices:resolve']({ noticeId: notice?.id ?? '', actionId: 'retry' })
    await flush()
    await h.runner.idle()
    view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('ready')
    h.runner.stop()
  })

  test('Stop holds the page after its step; Resume continues where it stopped', async () => {
    const h = await live()
    const pageId = await addOne(h)
    const stopped = await h.handlers['setup:stop']({ projectId: h.projectId, pageId })
    expect(stopped.state).toBe('running')
    await h.runner.idle()
    let view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('stopped')
    expect(view.action).toEqual({ kind: 'resume', label: 'Resume setup' })
    expect(getPage(h.db(), pageId, h.projectId)?.status).toBe('setting_up')
    // A stopped page is not picked by the loop.
    h.timers.fire()
    await flush()
    expect(h.runner.status().running).toBe(0)

    await h.handlers['setup:start']({ projectId: h.projectId, pageId })
    await h.runner.idle()
    view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('ready')
    h.runner.stop()
  })

  test('with the loop off an add waits; Start setup runs only that page', async () => {
    const h = await runnerHarness()
    const pageId = await addOne(h)
    const other = await addOne(h, 'https://textbolt.com/blog/other/')
    let view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('queued')
    expect(view.action).toEqual({ kind: 'retry', label: 'Start setup' })
    expect(h.claude.calls).toHaveLength(0)

    await h.handlers['setup:start']({ projectId: h.projectId, pageId })
    await h.runner.idle()
    view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('ready')
    expect(getPage(h.db(), other, h.projectId)?.status).toBe('setting_up')
  })

  test('Start on a tracked page with no content gaps writes only the gaps', async () => {
    const h = await live()
    const pageId = await addOne(h)
    await h.runner.idle()
    const runs = `SELECT id FROM coverage_runs WHERE page_id = ?`
    h.db().prepare(`DELETE FROM coverage_findings WHERE run_id IN (${runs})`).run(pageId)
    h.db().prepare(`DELETE FROM coverage_rows WHERE run_id IN (${runs})`).run(pageId)
    h.db().prepare(`DELETE FROM coverage_runs WHERE page_id = ?`).run(pageId)
    let view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.state).toBe('ready')
    expect(view.steps.find((step) => step.id === 'coverage')?.state).toBe('todo')
    const calls = h.claude.calls.length
    await h.handlers['setup:start']({ projectId: h.projectId, pageId })
    await h.runner.idle()
    view = await h.handlers['setup:page']({ projectId: h.projectId, pageId })
    expect(view.steps.find((step) => step.id === 'coverage')?.state).toBe('done')
    // Only the gaps step ran (a cached reply may answer it without a new call).
    expect(h.claude.calls.length).toBeLessThanOrEqual(calls + 1)
    expect(getPage(h.db(), pageId, h.projectId)?.status).toBe('tracked')
    h.runner.stop()
  })

  test('starting a check releases a first check that waited', async () => {
    const h = await live()
    const pageId = await addOne(h)
    await h.runner.idle()
    expect(firstCheckWaits(h.db(), pageId)).toBe(true)
    await Promise.resolve(
      h.handlers['checks:start']({
        projectId: h.projectId,
        pageIds: [pageId],
        marketIds: null,
        promptIds: null
      })
    ).catch(() => undefined)
    expect(firstCheckWaits(h.db(), pageId)).toBe(false)
    h.runner.stop()
  })
})
