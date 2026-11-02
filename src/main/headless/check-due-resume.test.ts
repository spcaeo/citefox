import { describe, expect, test } from 'vitest'
import { createCheckQueue } from '../queue/check-queue'
import { memoryQueuePauseStore } from '../queue/pause-store'
import { fixtureCheckRunner } from '../queue/runner'
import type { QueueKeyInput, QueueProjectInput } from '../queue/types'
import { manualClock } from '../scheduler/clock'
import type { AppSchedule, ScheduledPageInput, ScheduledProjectInput } from '../scheduler/types'
import { defaultAppSchedule } from '../storage/settings'
import {
  CHECK_DUE_EXIT_CAP,
  CHECK_DUE_EXIT_OK,
  memoryDuePassStore,
  runCheckDue,
  type CheckDueRunInput
} from './check-due'

const CHECKED = Date.parse('2026-04-06T08:00:00.000Z')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('due pass progress is recorded per job', () => {
  test('a pass paused part-way runs the rest later the same day, even in a new process', async () => {
    const clock = manualClock(NOON)
    const passStore = memoryDuePassStore()
    const pauseStore = memoryQueuePauseStore()
    const gui = openQueue(clock, { pauseStore })
    const runner = fixtureCheckRunner((job) => {
      if (job.pageId === 'page-1') gui.pause('all')
      return { outcome: 'ok', searches: [] }
    })
    const first = await runCheckDue({ ...input(clock, runner, gui), passStore })
    expect(first.stop).toBe('paused')
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1'])
    expect(passStore.read()?.jobIds).toHaveLength(1)

    gui.resume()
    const headless = openQueue(clock, { pauseStore })
    const second = await runCheckDue({ ...input(clock, runner, headless), passStore })
    expect(second.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(second.stop).not.toBe('already_ran')
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1', 'page-2'])
    expect(passStore.read()).toMatchObject({ day: '2026-04-20', pages: 2 })

    const third = await runCheckDue({ ...input(clock, runner, openQueue(clock)), passStore })
    expect(third.stop).toBe('already_ran')
    expect(runner.jobs).toHaveLength(2)
  })

  test('a pass stopped for a hand-off leaves the unstarted pages for the next pass', async () => {
    const clock = manualClock(NOON)
    const passStore = memoryDuePassStore()
    let handOff = false
    const runner = fixtureCheckRunner(() => {
      handOff = true
      return { outcome: 'ok', searches: [] }
    })
    const first = await runCheckDue({
      ...input(clock, runner, openQueue(clock)),
      passStore,
      shouldStop: () => handOff
    })
    expect(first.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1'])

    const second = await runCheckDue({ ...input(clock, runner, openQueue(clock)), passStore })
    expect(second.stop).toBe('finished')
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1', 'page-2'])
  })
})

describe('one blocked project does not stop the others', () => {
  test('a project at its cap is skipped and a later page of another project still runs', async () => {
    const clock = manualClock(NOON)
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const queue = twoProjectQueue(clock, [
      queueProject({ cap: 0, capRule: 'pause' }),
      queueProject({ projectId: 'proj-2', name: 'Other' })
    ])
    const result = await runCheckDue({
      ...input(clock, runner, queue),
      catalog: catalog([page()]),
      estimateSearches: () => 1,
      sleep: advance(clock)
    })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_CAP)
    expect(result.capRule).toBe('pause')
    expect(runner.jobs.map((job) => job.projectId)).toEqual(['proj-2'])
  })

  test('a project paused in the queue is skipped and a later page of another project still runs', async () => {
    const clock = manualClock(NOON)
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const queue = twoProjectQueue(clock, [
      queueProject({ paused: true }),
      queueProject({ projectId: 'proj-2', name: 'Other' })
    ])
    const result = await runCheckDue({
      ...input(clock, runner, queue),
      catalog: catalog([page()]),
      sleep: advance(clock)
    })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(result.errorMessage).toBeNull()
    expect(runner.jobs.map((job) => job.projectId)).toEqual(['proj-2'])
  })

  test('a page busy with a manual check is skipped without failing the pass', async () => {
    const clock = manualClock(NOON)
    let busy = false
    const queue = openQueue(clock, {
      pageRunning: (_projectId, pageId) => busy && pageId === 'page-1'
    })
    queue.enqueue({
      id: 'later',
      projectId: 'proj-1',
      pageId: 'page-9',
      marketIds: ['us'],
      reason: 'scheduled',
      promptIds: null,
      needsClaude: false,
      maxSearches: 0,
      notBefore: new Date(NOON + 10 * 60_000).toISOString()
    })
    const sleeps: number[] = []
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const result = await runCheckDue({
      ...input(clock, runner, queue),
      catalog: catalog([page()]),
      // The manual check starts after the due list was read.
      estimateSearches: () => {
        busy = true
        return 0
      },
      sleep: async (ms) => {
        sleeps.push(ms)
        clock.set(clock.now() + ms)
      }
    })
    expect(result).toMatchObject({ exitCode: CHECK_DUE_EXIT_OK, errorMessage: null })
    expect(result.stop).toBe('finished')
    expect(sleeps).toEqual([10 * 60_000])
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-9'])
    expect(queue.status().waiting).toBe(1)

    // The manual check finished and stored the page as checked: it is no longer due.
    busy = false
    const checked = page({
      markets: [
        { marketId: 'us', lastCheckedAt: new Date(NOON).toISOString(), firstCheckNotBefore: null }
      ]
    })
    await runCheckDue({ ...input(clock, runner, queue), catalog: catalog([checked]) })
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-9'])
    expect(queue.status().waiting).toBe(0)
  })
})

describe('headless runs only the work due now', () => {
  test('a later batch is left for the next OS job run instead of sleeping', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    queue.enqueue({
      id: 'later',
      projectId: 'proj-1',
      pageId: 'page-9',
      marketIds: ['us'],
      reason: 'scheduled',
      promptIds: null,
      needsClaude: false,
      maxSearches: 0,
      notBefore: new Date(NOON + 2 * 60 * 60_000).toISOString()
    })
    const sleeps: number[] = []
    const passStore = memoryDuePassStore()
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const result = await runCheckDue({
      ...input(clock, runner, queue),
      catalog: catalog([page()]),
      passStore,
      maxWaitMs: 60_000,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock.set(clock.now() + ms)
      }
    })
    expect(result).toMatchObject({ exitCode: CHECK_DUE_EXIT_OK, stop: 'finished' })
    expect(sleeps).toEqual([])
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1'])
    expect(passStore.read()?.jobIds).toHaveLength(1)
  })
})

function input(
  clock: ReturnType<typeof manualClock>,
  runner: ReturnType<typeof fixtureCheckRunner>,
  queue?: ReturnType<typeof createCheckQueue>
): CheckDueRunInput {
  return {
    clock,
    timeZone: 'UTC',
    runner,
    catalog: catalog([page(), page({ pageId: 'page-2', url: 'https://textbolt.com/other' })]),
    queue,
    keys: [searchKey()],
    queueProjects: [queueProject()]
  }
}

function openQueue(
  clock: ReturnType<typeof manualClock>,
  extra: Partial<Parameters<typeof createCheckQueue>[0]> = {}
): ReturnType<typeof createCheckQueue> {
  return createCheckQueue({
    clock,
    timeZone: 'UTC',
    keys: [searchKey()],
    projects: [queueProject()],
    ...extra
  })
}

/** A queue that already holds a proj-2 page due five minutes from now. */
function twoProjectQueue(
  clock: ReturnType<typeof manualClock>,
  projects: readonly QueueProjectInput[]
): ReturnType<typeof createCheckQueue> {
  const queue = openQueue(clock, { projects })
  queue.enqueue({
    id: 'other-later',
    projectId: 'proj-2',
    pageId: 'page-2',
    marketIds: ['us'],
    reason: 'scheduled',
    promptIds: null,
    needsClaude: false,
    maxSearches: 0,
    notBefore: new Date(NOON + 5 * 60_000).toISOString()
  })
  return queue
}

function advance(clock: ReturnType<typeof manualClock>): (ms: number) => Promise<void> {
  return async (ms) => {
    clock.set(clock.now() + ms)
  }
}

function catalog(
  pages: readonly ScheduledPageInput[],
  projects: readonly ScheduledProjectInput[] = [project()],
  app: AppSchedule = defaultAppSchedule()
): CheckDueRunInput['catalog'] {
  return { app, projects, pages }
}

function project(patch: Partial<ScheduledProjectInput> = {}): ScheduledProjectInput {
  return {
    projectId: 'proj-1',
    defaultIntervalDays: 14,
    dailyCheckTime: '08:00',
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    archived: false,
    nextCheckAt: null,
    pagesDueToday: 0,
    ...patch
  }
}

function page(patch: Partial<ScheduledPageInput> = {}): ScheduledPageInput {
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    label: 'Alerts',
    title: 'Text alerts',
    url: 'https://textbolt.com/text-alerts',
    status: 'tracked',
    intervalDays: 14,
    promptSetVersion: null,
    markets: [
      { marketId: 'us', lastCheckedAt: new Date(CHECKED).toISOString(), firstCheckNotBefore: null }
    ],
    ...patch
  }
}

function searchKey(): QueueKeyInput {
  return {
    keyId: 'key-1',
    name: 'Primary',
    provider: 'serpapi',
    cap: null,
    planLimit: null,
    state: 'ok',
    rotationOrder: 0,
    projectIds: []
  }
}

function queueProject(patch: Partial<QueueProjectInput> = {}): QueueProjectInput {
  return {
    projectId: 'proj-1',
    name: 'TextBolt',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false,
    ...patch
  }
}
