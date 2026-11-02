import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueueStatus } from '@shared/domain'
import { describe, expect, test } from 'vitest'
import { IpcRequestError } from '../ipc-request'
import { fixtureCheckRunner } from '../queue/runner'
import { openAppStorage } from '../storage/app-storage'
import { readAppSchedule } from '../storage/settings'
import { manualClock } from './clock'
import { createScheduleHandlers, bindScheduleQueueTray } from './ipc'
import { createCheckSession, memoryScheduleStore } from './session'
import type { ScheduledPageInput, ScheduledProjectInput } from './types'

const CHECKED = Date.parse('2026-04-06T08:00:00.000Z')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('schedule IPC', () => {
  test('getApp returns the defaults and updateApp keeps omitted fields', () => {
    const { schedule, session } = harness()
    expect(schedule.getApp()).toEqual({
      startAtLogin: true,
      catchUpAfterSleep: true,
      checkWhenClosed: false,
      dailyCheckTime: '08:00'
    })
    expect(schedule.updateApp({ startAtLogin: false })).toMatchObject({
      startAtLogin: false,
      catchUpAfterSleep: true,
      dailyCheckTime: '08:00'
    })
    expect(session.osJob.registered).toBe(false)
  })

  test('checkWhenClosed registers the OS job and turning it off removes the job', () => {
    const { schedule, session } = harness()
    schedule.updateApp({ checkWhenClosed: true })
    expect(session.osJob.registered).toBe(true)
    expect(session.queue.status().headlessJob).toBe(true)
    schedule.updateApp({ checkWhenClosed: false })
    expect(session.osJob.registered).toBe(false)
    expect(session.queue.status().headlessJob).toBe(false)
    schedule.updateApp({ checkWhenClosed: true })
    expect(session.osJob.registered).toBe(true)
  })

  test('getProject keeps nextCheckAt while paused and reports no pages due', () => {
    const { schedule } = harness()
    const open = schedule.getProject({ projectId: 'proj-1' })
    expect(open.pagesDueToday).toBe(1)
    expect(open.nextCheckAt).toBe('2026-04-20T08:00:00.000Z')
    const paused = schedule.updateProject({ projectId: 'proj-1', paused: true })
    expect(paused.paused).toBe(true)
    expect(paused.pagesDueToday).toBe(0)
    expect(paused.nextCheckAt).toBe(open.nextCheckAt)
    expect(schedule.listDue({ projectId: 'proj-1' }).pages).toEqual([])
  })

  test('listDue skips a paused page, an archived project, and quiet hours that leave today', () => {
    const store = memoryScheduleStore({
      projects: [
        project(),
        project({ projectId: 'paused-page', paused: false }),
        project({ projectId: 'archived', archived: true }),
        project({ projectId: 'overnight', quietFrom: '22:00', quietUntil: '07:00' }),
        project({ projectId: 'off', quietFrom: '08:00', quietUntil: '08:00' })
      ],
      pages: [
        page(),
        page({ projectId: 'paused-page', pageId: 'held', status: 'paused' }),
        page({ projectId: 'paused-page', pageId: 'live' }),
        page({ projectId: 'archived', pageId: 'old' }),
        page({ projectId: 'overnight', pageId: 'night' }),
        page({ projectId: 'off', pageId: 'equal' })
      ]
    })
    const schedule = createScheduleHandlers(
      createCheckSession({
        clock: manualClock(Date.parse('2026-04-20T22:30:00.000Z')),
        timeZone: 'UTC',
        store
      })
    )
    const due = schedule.listDue({ projectId: null })
    expect(due.day).toBe('2026-04-20')
    expect(due.pages.map((item) => item.pageId).sort()).toEqual(['equal', 'live', 'page-1'])
    expect(schedule.getProject({ projectId: 'archived' })).toMatchObject({
      nextCheckAt: null,
      pagesDueToday: 0
    })
    expect(schedule.getProject({ projectId: 'off' }).pagesDueToday).toBe(1)
  })

  test('a half quiet window is rejected and the stored schedule stays', () => {
    const { schedule } = harness()
    expect(() => schedule.updateProject({ projectId: 'proj-1', quietFrom: '22:00' })).toThrow(
      'schedule:updateProject: Invalid schedule'
    )
    expect(schedule.getProject({ projectId: 'proj-1' }).quietFrom).toBeNull()
  })

  test('invalid requests name the channel and do not echo the arguments', () => {
    const { schedule } = harness()
    expect(() => schedule.updateApp({ dailyCheckTime: '25:99' })).toThrow(IpcRequestError)
    try {
      schedule.updateApp({ dailyCheckTime: '25:99' })
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(IpcRequestError)
      expect((error as Error).message).toBe('schedule:updateApp: Invalid request')
      expect((error as Error).message).not.toContain('25:99')
    }
    try {
      schedule.getProject({ projectId: 'missing-id' })
    } catch (error: unknown) {
      expect((error as Error).message).toBe('schedule:getProject: Unknown project')
      expect((error as Error).message).not.toContain('missing-id')
    }
    expect(() => schedule.listDue({ projectId: 'nope' })).toThrow(
      'schedule:listDue: Unknown project'
    )
  })

  test('the handler binder reads Claude concurrency and does not copy a keychain ref', () => {
    const dir = mkdtempSync(join(tmpdir(), 'citefox-binder-'))
    const storage = openAppStorage(dir)
    try {
      const events: QueueStatus[] = []
      const bound = bindScheduleQueueTray({
        now: () => new Date(NOON),
        timeZone: 'UTC',
        emit: (status) => {
          events.push(status)
        },
        claudeConcurrency: () => 4,
        keys: () => [
          {
            id: 'key-1',
            provider: 'serpapi',
            name: 'Primary',
            keychainRef: 'secret-keychain-ref',
            hint: 'abcd',
            rotationOrder: 0,
            cap: 20,
            on: true,
            projectIds: [],
            state: 'ok',
            lastReason: null,
            serpapiUsage: { used: 1, planLimit: 50, plan: 'Developer' }
          }
        ],
        storage
      })
      expect(bound.schedule.getApp().checkWhenClosed).toBe(false)
      bound.schedule.updateApp({ startAtLogin: false })
      expect(readAppSchedule(storage.paths.settingsFile).startAtLogin).toBe(false)
      const status = bound.queue.getStatus()
      expect(status.claudeConcurrency).toBe(4)
      expect(status.keys[0]).toMatchObject({ keyId: 'key-1', planLimit: 50, state: 'ok' })
      expect(JSON.stringify(status)).not.toContain('secret-keychain-ref')
      expect(events).toEqual([])
    } finally {
      storage.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function harness(): {
  schedule: ReturnType<typeof createScheduleHandlers>
  session: ReturnType<typeof createCheckSession>
} {
  const session = createCheckSession({
    clock: manualClock(NOON),
    timeZone: 'UTC',
    store: memoryScheduleStore({ projects: [project()], pages: [page()] }),
    runner: fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
  })
  return { schedule: createScheduleHandlers(session), session }
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
      {
        marketId: 'us',
        lastCheckedAt: new Date(CHECKED).toISOString(),
        firstCheckNotBefore: null
      }
    ],
    ...patch
  }
}
