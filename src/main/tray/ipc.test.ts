import { TRAY_MENU_CHECK_LIMIT } from '@shared/domain'
import type { QueueStatus, TrayLastCheck } from '@shared/domain'
import { describe, expect, test } from 'vitest'
import { IpcRequestError } from '../ipc-request'
import { manualClock } from '../scheduler/clock'
import { createCheckSession, memoryScheduleStore } from '../scheduler/session'
import type { ScheduledPageInput, ScheduledProjectInput } from '../scheduler/types'
import { CHECK_CANCELLED_MESSAGE } from '../queue/runner'
import { createTrayHandlers } from './ipc'
import { shouldRecordTrayCheck } from './record'

const CHECKED = Date.parse('2026-04-06T08:00:00.000Z')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('tray IPC', () => {
  test('the line stays not running and a paused project reports 0 pages due', () => {
    const { tray, session } = harness()
    expect(tray.getLine({ projectId: 'proj-1' })).toEqual({
      projectId: 'proj-1',
      running: false,
      pagesDueToday: 1
    })
    session.store.saveProject(project({ paused: true }))
    expect(tray.getLine({ projectId: 'proj-1' })).toEqual({
      projectId: 'proj-1',
      running: false,
      pagesDueToday: 0
    })
    session.store.setTrayRunning(true)
    expect(tray.getLine({ projectId: 'proj-1' }).running).toBe(true)
  })

  test('the menu lists paused-today, waiting, and the latest 5 finished checks', () => {
    const checks = [1, 2, 3, 4, 5, 6].map((n) => lastCheck(n))
    const { tray, session } = harness(checks)
    session.queue.enqueue({
      id: 'waiting-1',
      projectId: 'proj-1',
      pageId: 'page-1',
      marketIds: ['us'],
      reason: 'manual',
      promptIds: null,
      needsClaude: false,
      maxSearches: 0,
      notBefore: new Date(NOON - 1).toISOString()
    })
    session.queue.pause('today')
    const menu = tray.getMenu()
    expect(menu.pausedToday).toBe(true)
    expect(menu.pagesWaiting).toBe(1)
    expect(menu.pagesDueToday).toBe(1)
    expect(TRAY_MENU_CHECK_LIMIT).toBe(5)
    expect(menu.lastChecks.map((item) => item.pageId)).toEqual([
      'page-6',
      'page-5',
      'page-4',
      'page-3',
      'page-2'
    ])
  })

  test('a cancelled run is not listed as a finished or failed check', () => {
    expect(
      shouldRecordTrayCheck({
        outcome: 'error',
        message: CHECK_CANCELLED_MESSAGE,
        searches: []
      })
    ).toBe(false)
    expect(shouldRecordTrayCheck({ outcome: 'cancelled', searches: [] })).toBe(false)
    expect(shouldRecordTrayCheck({ outcome: 'error', message: 'boom', searches: [] })).toBe(false)
    expect(shouldRecordTrayCheck({ outcome: 'ok', searches: [] })).toBe(true)
    const { tray, session } = harness([])
    const kept = shouldRecordTrayCheck({
      outcome: 'error',
      message: CHECK_CANCELLED_MESSAGE,
      searches: []
    })
      ? [lastCheck(1)]
      : []
    session.store.setLastChecks(kept)
    expect(tray.getMenu().lastChecks).toEqual([])
    session.store.setLastChecks(
      shouldRecordTrayCheck({ outcome: 'ok', searches: [] }) ? [lastCheck(1)] : []
    )
    expect(tray.getMenu().lastChecks).toEqual([lastCheck(1)])
  })

  test('setRunning flips the sidebar line and pushes queue status', () => {
    const emitted: QueueStatus[] = []
    const { tray, session } = harness([], (status) => {
      emitted.push(status)
    })
    expect(tray.getLine({ projectId: 'proj-1' }).running).toBe(false)
    tray.setRunning(true)
    expect(tray.getLine({ projectId: 'proj-1' }).running).toBe(true)
    expect(session.queue.status().trayRunning).toBe(true)
    expect(emitted.at(-1)?.trayRunning).toBe(true)
    tray.setRunning(false)
    expect(tray.getLine({ projectId: 'proj-1' }).running).toBe(false)
    expect(session.queue.status().trayRunning).toBe(false)
    expect(emitted.at(-1)?.trayRunning).toBe(false)
  })

  test('an unknown project is rejected without echoing the id', () => {
    const { tray } = harness()
    try {
      tray.getLine({ projectId: 'missing-id' })
      throw new Error('expected a rejection')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(IpcRequestError)
      expect((error as Error).message).toBe('tray:getLine: Unknown project')
      expect((error as Error).message).not.toContain('missing-id')
    }
  })
})

function harness(
  lastChecks: readonly TrayLastCheck[] = [],
  emitStatus?: (status: QueueStatus) => void
): {
  tray: ReturnType<typeof createTrayHandlers>
  session: ReturnType<typeof createCheckSession>
} {
  const session = createCheckSession({
    clock: manualClock(NOON),
    timeZone: 'UTC',
    emitStatus,
    store: memoryScheduleStore({
      projects: [project()],
      pages: [page()],
      lastChecks,
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
    })
  })
  return { tray: createTrayHandlers(session), session }
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

function lastCheck(n: number): TrayLastCheck {
  return {
    projectId: 'proj-1',
    pageId: `page-${n}`,
    label: `Page ${n}`,
    score: n,
    change: 1,
    finishedAt: new Date(Date.parse('2026-04-01T00:00:00.000Z') + n * 1000).toISOString()
  }
}
