import { afterEach, describe, expect, test } from 'vitest'
import { listLlmCalls } from '../storage/llm-calls'
import { getPageSetupJob, writePageSetupJob } from '../storage/page-setup-jobs'
import { getPage, listPageMarkets, setPageMarketFirstCheckNotBefore } from '../storage/pages'
import { writeProjectSchedule, readProjectSchedule } from '../storage/project-schedule'
import { MAX_SETUP_ATTEMPTS, SETUP_BACKOFF_MS, STAGGER_LEAD_MS } from './constants'
import { cleanupRunnerHarness, flush, HOUR, runnerHarness, START } from './runner.test-helper'

afterEach(() => {
  cleanupRunnerHarness()
})

describe('background page setup', () => {
  test('reads, writes the profile and prompts, tracks the page, then writes coverage', async () => {
    const h = await runnerHarness()
    const [pageId] = await h.addPages(1)
    if (pageId === undefined) throw new Error('no page')

    expect(h.runner.pump()).toBe(1)
    expect(h.runner.status().running).toBe(1)
    await h.runner.idle()

    const page = getPage(h.db(), pageId, h.projectId)
    expect(page).toMatchObject({ status: 'tracked', promptSetVersion: 1, setupStep: 'check' })
    expect(getPageSetupJob(h.db(), pageId)).toMatchObject({
      state: 'done',
      step: 'coverage',
      attempts: 0,
      lastError: null
    })
    const coverage = await h.handlers['gaps:get']({ projectId: h.projectId, pageId })
    expect(coverage?.rows).toHaveLength(10)
    // Profile, prompts, then the content gaps (matrix, audit, two fixes calls): each call is logged.
    expect(h.claude.calls).toHaveLength(6)
    const calls = listLlmCalls(h.db(), { since: null, projectId: h.projectId, appTable: false })
    expect(calls.map((call) => call.templateKind).sort()).toEqual([
      'buyer_profile',
      'buyer_prompts',
      'coverage_fixes',
      'coverage_fixes',
      'coverage_matrix',
      'page_audit'
    ])
    expect(
      calls.every((call) => call.source === 'pipeline' && call.projectId === h.projectId)
    ).toBe(true)
    expect(h.http.requests.some((url) => url.startsWith('https://r.jina.ai/'))).toBe(true)
    expect(h.progress.map((event) => `${event.step}:${event.state}`)).toEqual([
      'read:running',
      'profile:running',
      'prompts:running',
      'coverage:running',
      'coverage:done'
    ])
    const status = h.runner.status()
    expect(status).toMatchObject({ waiting: 0, running: 0, doneToday: 1, failed: 0 })
    expect(await h.handlers['setup:status']()).toMatchObject({ doneToday: 1 })
  })

  test('leaves far stagger holds alone, oldest first, within the rate', async () => {
    const h = await runnerHarness()
    await h.handlers['setup:setRate']({ pagesPerHour: 2 })
    const fresh = await h.addPages(1, { ageMs: 5 * 60_000, prefix: 'fresh' })
    const staggered = await h.addPages(1, { ageMs: 3 * HOUR, prefix: 'later' })
    const old = await h.addPages(3, { ageMs: 2 * HOUR, prefix: 'old' })
    const held = staggered[0] ?? ''
    setPageMarketFirstCheckNotBefore(
      h.db(),
      held,
      listPageMarkets(h.db(), held)[0]?.marketId ?? '',
      new Date(START + STAGGER_LEAD_MS + HOUR).toISOString()
    )

    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    // Two pages this hour: the throttle holds the third.
    expect(h.runner.pump()).toBe(0)
    expect(h.runner.status().holdReason).toContain('2 pages were set up in the last hour')
    const tracked = (ids: readonly string[]): boolean[] =>
      ids.map((id) => getPage(h.db(), id, h.projectId)?.status === 'tracked')
    expect(tracked(old)).toEqual([true, true, false])
    expect(tracked(fresh)).toEqual([false])
    expect(tracked(staggered)).toEqual([false])

    h.clock.now += HOUR
    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    expect(tracked(old)).toEqual([true, true, true])
    expect(tracked(fresh)).toEqual([true])
    expect(tracked(staggered)).toEqual([false])
  })

  test('a failed read retries with backoff, gives up after the last try, and Retry starts over', async () => {
    const h = await runnerHarness()
    const [pageId] = await h.addPages(1)
    if (pageId === undefined) throw new Error('no page')
    h.http.readFails = true
    for (let attempt = 1; attempt <= MAX_SETUP_ATTEMPTS; attempt += 1) {
      expect(h.runner.pump()).toBe(1)
      await h.runner.idle()
      const job = getPageSetupJob(h.db(), pageId)
      expect(job?.attempts).toBe(attempt)
      expect(job?.step).toBe('read')
      if (attempt < MAX_SETUP_ATTEMPTS) {
        expect(job?.state).toBe('retry')
        expect(h.runner.pump()).toBe(0)
        h.clock.now += SETUP_BACKOFF_MS[attempt - 1] ?? 0
      } else {
        expect(job?.state).toBe('failed')
        expect(job?.nextAttemptAt).toBeNull()
      }
    }
    h.clock.now += 24 * HOUR
    expect(h.runner.pump()).toBe(0)
    const status = await h.handlers['setup:status']()
    expect(status.failed).toBe(1)
    expect(status.waiting).toBe(0)
    expect(status.failures[0]).toMatchObject({ pageId, step: 'read', attempts: 4, retryAt: null })
    expect(status.failures[0]?.reason.length).toBeGreaterThan(0)
    expect(h.claude.calls).toHaveLength(0)

    h.http.readFails = false
    const retried = await h.handlers['setup:retry']({ projectId: h.projectId })
    expect(retried.failed).toBe(0)
    expect(h.runner.status().running).toBe(1)
    await h.runner.idle()
    expect(getPage(h.db(), pageId, h.projectId)?.status).toBe('tracked')
  })

  test('the wait rule holds the project after a Claude limit and keeps the read', async () => {
    const h = await runnerHarness()
    const pages = await h.addPages(2)
    h.claude.mode = 'limit'
    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    const job = getPageSetupJob(h.db(), pages[0] ?? '')
    expect(job).toMatchObject({ state: 'retry', step: 'profile', attempts: 0 })
    expect(Date.parse(job?.nextAttemptAt ?? '')).toBe(START + HOUR)
    // The project waits: the second page does not start and spend another call.
    expect(h.runner.pump()).toBe(0)
    expect(h.runner.status().holdReason).toContain('after the limit resets')
    expect(h.claude.calls).toHaveLength(1)

    h.claude.mode = 'ok'
    h.clock.now += HOUR
    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    expect(pages.map((id) => getPage(h.db(), id, h.projectId)?.status)).toEqual([
      'tracked',
      'tracked'
    ])
    // The stored read was reused: one Jina read per page.
    expect(h.http.requests.filter((url) => url.startsWith('https://r.jina.ai/'))).toHaveLength(2)
  })

  test('the ask rule records one notice; Try again now retries the project', async () => {
    const h = await runnerHarness()
    const [pageId] = await h.addPages(1)
    h.setFallback('ask')
    h.claude.mode = 'limit'
    h.runner.pump()
    await h.runner.idle()
    const listed = await h.handlers['notices:list']()
    expect(listed.notices).toHaveLength(1)
    const notice = listed.notices[0]
    expect(notice).toMatchObject({
      kind: 'claude_ask',
      projectId: h.projectId,
      projectName: 'TextBolt',
      actions: [
        { id: 'retry', primary: true },
        { id: 'not_now', primary: false }
      ]
    })
    expect(h.notices).toHaveLength(1)
    h.clock.now += 2 * HOUR
    expect(h.runner.pump()).toBe(0)

    h.claude.mode = 'ok'
    const result = await h.handlers['notices:resolve']({
      noticeId: notice?.id ?? '',
      actionId: 'retry'
    })
    expect(result.notice.resolution).toBe('retry')
    expect(result.message).toContain('trying Claude again')
    await h.runner.idle()
    expect(getPage(h.db(), pageId ?? '', h.projectId)?.status).toBe('tracked')
    expect((await h.handlers['notices:list']()).notices).toHaveLength(0)
  })

  test('stops between steps; the next runner continues from the stored step', async () => {
    const h = await runnerHarness()
    const [pageId] = await h.addPages(1)
    if (pageId === undefined) throw new Error('no page')
    h.runner.pump()
    // Quit while the read is in flight: the read finishes, then nothing else runs.
    h.runner.stop()
    await h.runner.idle()
    expect(getPageSetupJob(h.db(), pageId)).toMatchObject({ state: 'running', step: 'read' })
    expect(getPage(h.db(), pageId, h.projectId)?.setupStep).toBe('profile')
    expect(h.claude.calls).toHaveLength(0)

    const { createSetupRunner } = await import('./runner')
    const next = createSetupRunner({
      host: h.host,
      timers: h.timers,
      timeZone: () => 'UTC'
    })
    expect(next.pump()).toBe(1)
    await next.idle()
    expect(getPage(h.db(), pageId, h.projectId)?.status).toBe('tracked')
    expect(h.http.requests.filter((url) => url.startsWith('https://r.jina.ai/'))).toHaveLength(1)
    next.stop()
  })

  test('pause, paused projects, and quiet hours start nothing; the loop ticks on a timer', async () => {
    const h = await runnerHarness()
    await h.addPages(1)
    await h.handlers['setup:pause']({ paused: true })
    expect(h.runner.pump()).toBe(0)
    expect((await h.handlers['setup:status']()).holdReason).toBe('Background setup is paused.')
    await h.handlers['setup:pause']({ paused: false })
    h.runner.stop()

    const quiet = await runnerHarness()
    await quiet.addPages(1)
    writeProjectSchedule(quiet.db(), {
      ...readProjectSchedule(quiet.db(), quiet.projectId),
      quietFrom: '11:00',
      quietUntil: '13:00'
    })
    expect(quiet.runner.pump()).toBe(0)
    quiet.clock.now += 2 * HOUR
    quiet.runner.start()
    expect(quiet.timers.pending()).toEqual([2 * 60_000])
    quiet.timers.fire()
    await flush()
    expect(quiet.runner.status().running + quiet.runner.status().doneToday).toBe(1)
    await quiet.runner.idle()
    quiet.runner.stop()
    expect(quiet.timers.pending()).toEqual([])
  })

  test('runs as many pages at once as Claude "calls at once" allows', async () => {
    const h = await runnerHarness()
    h.storage.writeSettings({ ...h.storage.readSettings(), claudeConcurrency: 2 })
    await h.addPages(3)
    expect(h.runner.pump()).toBe(2)
    expect(h.runner.pump()).toBe(0)
    const busy = h.runner.status()
    expect(busy).toMatchObject({ running: 2, waiting: 1 })
    // NFR-14: each count's page list has exactly that many pages.
    expect(busy.pages?.running).toHaveLength(busy.running)
    expect(busy.pages?.waiting).toHaveLength(busy.waiting)
    expect(busy.pages?.running.every((page) => page.url.startsWith('http'))).toBe(true)
    await h.runner.idle()
    expect(h.runner.pump()).toBe(1)
    await h.runner.idle()
    const done = h.runner.status()
    expect(done).toMatchObject({ running: 0, waiting: 0, doneToday: 3 })
    expect(done.pages?.doneToday).toHaveLength(3)
    expect(new Set(done.pages?.doneToday.map((page) => page.pageId)).size).toBe(3)
  })

  test('a headless run stops starting pages when its budget ends', async () => {
    const h = await runnerHarness()
    await h.addPages(3)
    await h.runner.runFor(0)
    expect(h.runner.status().doneToday).toBe(0)
    let calls = 0
    await h.runner.runFor(60_000, () => {
      calls += 1
      return calls > 1
    })
    expect(h.runner.status().doneToday).toBe(1)
    await h.runner.runFor(60_000)
    expect(h.runner.status()).toMatchObject({ doneToday: 3, waiting: 0 })
  })

  test('a page finished by hand is only marked tracked, with no Claude call', async () => {
    const h = await runnerHarness()
    const [pageId] = await h.addPages(1)
    if (pageId === undefined) throw new Error('no page')
    writePageSetupJob(h.db(), {
      pageId,
      state: 'retry',
      step: 'read',
      attempts: 1,
      nextAttemptAt: new Date(START - 1).toISOString(),
      lastError: 'Earlier failure',
      nextStep: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date(START - HOUR).toISOString()
    })
    h.runner.pump()
    await h.runner.idle()
    const calls = h.claude.calls.length
    expect(calls).toBe(6)
    // A second page that already has prompts only gets its content gaps.
    const [second] = await h.addPages(1, { prefix: 'second' })
    await h.handlers['pages:readStart']({
      projectId: h.projectId,
      pageId: second ?? '',
      reader: 'jina',
      suppliedText: null
    })
    await h.handlers['buyerProfile:generate']({ projectId: h.projectId, pageId: second ?? '' })
    await h.handlers['prompts:generate']({ projectId: h.projectId, pageId: second ?? '' })
    h.runner.pump()
    await h.runner.idle()
    expect(getPage(h.db(), second ?? '', h.projectId)?.status).toBe('tracked')
    // Profile, prompts, matrix and audit. The fixes call has the same input as the
    // first page's (same headings, rows and sections, no URL), so its stored reply answers.
    expect(h.claude.calls).toHaveLength(calls + 4)
  })
})
