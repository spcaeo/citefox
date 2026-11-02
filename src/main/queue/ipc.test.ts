import type { QueueStatus } from '@shared/domain'
import { describe, expect, test } from 'vitest'
import { IpcRequestError } from '../ipc-request'
import { memoryDuePassStore, type DuePassStore } from '../headless'
import { manualClock } from '../scheduler/clock'
import { createCheckSession, memoryScheduleStore } from '../scheduler/session'
import type { ScheduledPageInput, ScheduledProjectInput } from '../scheduler/types'
import { createQueueHandlers, queueKeysFromApiKeys } from './ipc'
import { fixtureCheckRunner } from './runner'
import type { QueueKeyInput, UsageSeedStore } from './types'

const CHECKED = Date.parse('2026-04-06T08:00:00.000Z')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('queue IPC', () => {
  test('getStatus does not emit, and pause and resume emit when the state changes', () => {
    const { queue, events } = harness()
    const status = queue.getStatus()
    expect(status.state).toBe('running')
    expect(status.claudeConcurrency).toBe(2)
    expect(events).toEqual([])
    const paused = queue.pause({ scope: 'all' })
    expect(paused).toMatchObject({ state: 'paused_all', nextRunAt: null })
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(paused)
    queue.pause({ scope: 'all' })
    expect(events).toHaveLength(1)
    const today = queue.pause({ scope: 'today' })
    expect(today.state).toBe('paused_today')
    expect(events).toHaveLength(2)
    const resumed = queue.resume()
    expect(resumed.state).toBe('running')
    expect(events).toHaveLength(3)
    expect(events[2]).toMatchObject({ state: 'running' })
  })

  test('a bad pause scope names the channel and does not echo the scope', () => {
    const { queue } = harness()
    try {
      queue.pause({ scope: 'forever' })
      throw new Error('expected a rejection')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(IpcRequestError)
      expect((error as Error).message).toBe('queue:pause: Invalid request')
      expect((error as Error).message).not.toContain('forever')
    }
  })

  test('checkDue runs the page, emits queue:status when a search is counted, and the same day does not run again', async () => {
    const { queue, events, runner } = harness()
    const first = await queue.checkDue()
    expect(first.started).toBe(true)
    expect(first.pages).toBe(1)
    expect(first.jobIds).toHaveLength(1)
    expect(runner.jobs).toHaveLength(1)
    expect(events.some((status) => status.running === 1)).toBe(true)
    expect(events.some((status) => status.keys[0]?.used === 1)).toBe(true)
    const before = events.length
    const second = await queue.checkDue()
    expect(second).toEqual({ started: false, jobIds: first.jobIds, pages: 1 })
    expect(runner.jobs).toHaveLength(1)
    expect(events).toHaveLength(before)
  })

  test('a paused queue does not emit a run, and resume lets the same day start', async () => {
    const { queue, runner } = harness()
    queue.pause({ scope: 'all' })
    const held = await queue.checkDue()
    expect(held).toEqual({ started: false, jobIds: [], pages: 0 })
    expect(runner.jobs).toEqual([])
    queue.resume()
    const started = await queue.checkDue()
    expect(started.started).toBe(true)
    expect(runner.jobs).toHaveLength(1)
  })

  test('two sessions share one day-pass store', async () => {
    const passStore = memoryDuePassStore()
    const first = harness({ passStore })
    const second = harness({ passStore })
    const started = await first.queue.checkDue()
    expect(started.started).toBe(true)
    expect(first.runner.jobs).toHaveLength(1)
    const again = await second.queue.checkDue()
    expect(again).toEqual({ started: false, jobIds: started.jobIds, pages: 1 })
    expect(second.runner.jobs).toEqual([])
    expect(second.queue.getStatus().waiting).toBe(0)
  })

  test('a month-to-date usage seed is on the status and the default seed is empty', () => {
    const seeded = harness({
      usageSeedStore: {
        monthToDate: () => [{ keyId: 'key-1', projectId: 'proj-1', month: '2026-04', searches: 7 }]
      }
    })
    expect(seeded.queue.getStatus().projects[0]?.used).toBe(7)
    expect(seeded.queue.getStatus().keys[0]?.used).toBe(7)
    const fresh = harness()
    expect(fresh.queue.getStatus().projects[0]?.used).toBe(0)
    expect(fresh.queue.getStatus().keys[0]?.used).toBe(0)
  })

  test('getStatus shows usage rows written after the session started', () => {
    let searches = 0
    const { queue } = harness({
      usageSeedStore: {
        monthToDate: () =>
          searches === 0
            ? []
            : [{ keyId: 'key-1', projectId: 'proj-1', month: '2026-04', searches }]
      }
    })
    expect(queue.getStatus().keys[0]?.used).toBe(0)
    expect(queue.getStatus().projects[0]?.used).toBe(0)
    searches = 11
    expect(queue.getStatus().keys[0]?.used).toBe(11)
    expect(queue.getStatus().projects[0]?.used).toBe(11)
    searches = 11
    expect(queue.getStatus().keys[0]?.used).toBe(11)
  })

  test('queueKeysFromApiKeys drops the keychain ref and turns an off key off', () => {
    const rows = queueKeysFromApiKeys([
      {
        id: 'key-1',
        provider: 'serpapi',
        name: 'Primary',
        keychainRef: 'secret-keychain-ref',
        hint: 'abcd',
        rotationOrder: 2,
        cap: 9,
        on: false,
        projectIds: ['proj-1'],
        state: 'ok',
        lastReason: null,
        serpapiUsage: { used: 3, planLimit: 40, plan: null }
      }
    ])
    expect(rows).toEqual([
      {
        keyId: 'key-1',
        name: 'Primary',
        provider: 'serpapi',
        cap: 9,
        planLimit: 40,
        state: 'off',
        rotationOrder: 2,
        projectIds: ['proj-1']
      }
    ])
    expect(JSON.stringify(rows)).not.toContain('secret-keychain-ref')
  })
})

function harness(input: { passStore?: DuePassStore; usageSeedStore?: UsageSeedStore } = {}): {
  queue: ReturnType<typeof createQueueHandlers>
  events: QueueStatus[]
  runner: ReturnType<typeof fixtureCheckRunner>
} {
  const events: QueueStatus[] = []
  const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [{ slotId: 's1' }] }))
  const session = createCheckSession({
    clock: manualClock(NOON),
    timeZone: 'UTC',
    passStore: input.passStore,
    usageSeedStore: input.usageSeedStore,
    store: memoryScheduleStore({
      projects: [project()],
      pages: [page()],
      keys: [searchKey()],
      queueProjects: [
        {
          projectId: 'proj-1',
          name: 'TextBolt',
          cap: null,
          capRule: 'pause',
          dedicatedKeyId: null,
          paused: false
        }
      ]
    }),
    runner,
    emitStatus: (status) => {
      events.push(status)
    }
  })
  return { queue: createQueueHandlers(session), events, runner }
}

function project(): ScheduledProjectInput {
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
    pagesDueToday: 0
  }
}

function page(): ScheduledPageInput {
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
      {
        marketId: 'us',
        lastCheckedAt: new Date(CHECKED).toISOString(),
        firstCheckNotBefore: null
      }
    ]
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
