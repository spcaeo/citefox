import { describe, expect, test } from 'vitest'
import { createQueueHandlers } from '../queue/ipc'
import type { CheckRunResult, CheckRunner } from '../queue/runner'
import type { QueueKeyInput, RunningJob } from '../queue/types'
import { manualClock } from './clock'
import { createCheckSession, memoryScheduleStore } from './session'
import type { ScheduledPageInput, ScheduledProjectInput } from './types'

const CHECKED = Date.parse('2026-04-06T08:00:00.000Z')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('one due pass at a time', () => {
  test('the renderer and the tray asking at once share one pass', async () => {
    let active = 0
    let peak = 0
    const jobs: RunningJob[] = []
    const runner: CheckRunner = {
      async run(job): Promise<CheckRunResult> {
        jobs.push(job)
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { outcome: 'ok', searches: [] }
      }
    }
    const session = createCheckSession({
      clock: manualClock(NOON),
      timeZone: 'UTC',
      store: memoryScheduleStore({
        projects: [project()],
        pages: [page('page-1'), page('page-2')],
        keys: [searchKey()]
      }),
      runner
    })
    const settled: number[] = []
    const queue = createQueueHandlers(session)
    queue.onPassSettled(() => {
      settled.push(jobs.length)
    })
    const fromRenderer = queue.checkDue()
    const fromTray = queue.checkDue()
    const [renderer, tray] = await Promise.all([fromRenderer, fromTray])
    expect(peak).toBe(1)
    expect(jobs.map((job) => job.pageId)).toEqual(['page-1', 'page-2'])
    expect(tray).toBe(renderer)
    expect(settled).toEqual([2])
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

function page(pageId: string): ScheduledPageInput {
  return {
    projectId: 'proj-1',
    pageId,
    label: pageId,
    title: pageId,
    url: `https://textbolt.com/${pageId}`,
    status: 'tracked',
    intervalDays: 14,
    promptSetVersion: null,
    markets: [
      { marketId: 'us', lastCheckedAt: new Date(CHECKED).toISOString(), firstCheckNotBefore: null }
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
