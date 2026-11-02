import { describe, expect, test } from 'vitest'
import { createQueueHandlers } from '../queue/ipc'
import { CHECK_CANCELLED_MESSAGE, fixtureCheckRunner } from '../queue/runner'
import type { QueueKeyInput, QueueProjectInput } from '../queue/types'
import { manualClock } from './clock'
import { scheduledCheckDisposition } from './outcome'
import { createCheckSession, memoryScheduleStore } from './session'
import type { ScheduledPageInput, ScheduledProjectInput } from './types'

const CHECKED = Date.parse('2026-04-06T08:00:00.000Z')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('cancelled scheduled check', () => {
  test('a cancel is skipped for the day and is not counted as a failure or retried', async () => {
    expect(scheduledCheckDisposition('cancelled')).toBe('skip')
    expect(scheduledCheckDisposition('error')).toBe('fail')
    expect(scheduledCheckDisposition('rate_limited')).toBe('retry')
    expect(scheduledCheckDisposition('ok')).toBe('done')

    const lines: string[] = []
    const runner = fixtureCheckRunner((job) =>
      job.pageId === 'page-1'
        ? { outcome: 'error', message: CHECK_CANCELLED_MESSAGE, searches: [] }
        : { outcome: 'ok', searches: [] }
    )
    const session = createCheckSession({
      clock: manualClock(NOON),
      timeZone: 'UTC',
      store: memoryScheduleStore({
        projects: [project()],
        pages: [page('page-1', 'Alerts'), page('page-2', 'Other')],
        keys: [searchKey()],
        queueProjects: [queueProject()]
      }),
      runner,
      logger: {
        error(message) {
          lines.push(message)
        }
      }
    })
    const queue = createQueueHandlers(session)
    const first = await queue.checkDue()
    expect(first).toMatchObject({ started: true, pages: 2 })
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1', 'page-2'])
    expect(session.queue.status()).toMatchObject({ running: 0, waiting: 0 })
    expect(lines).toEqual([])
    const second = await queue.checkDue()
    expect(second).toEqual({ started: false, jobIds: first.jobIds, pages: 2 })
    expect(runner.jobs).toHaveLength(2)
  })
})

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

function page(pageId: string, label: string): ScheduledPageInput {
  return {
    projectId: 'proj-1',
    pageId,
    label,
    title: label,
    url: `https://textbolt.com/${pageId}`,
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

function queueProject(): QueueProjectInput {
  return {
    projectId: 'proj-1',
    name: 'TextBolt',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false
  }
}
