import { describe, expect, test, vi } from 'vitest'
import { fixtureCheckRunner } from '../queue/runner'
import { manualClock } from '../scheduler/clock'
import { defaultAppSchedule } from '../storage/settings'
import {
  createCheckDueLaunchRequest,
  finishCheckDuePass,
  noteCheckDueActivate,
  noteCheckDueSecondInstance,
  runCheckDueCommand
} from './index'

const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('opening CiteFox while the headless job runs', () => {
  test('a Dock or Finder activate asks for the window, like a second launch', () => {
    const request = createCheckDueLaunchRequest()
    noteCheckDueActivate(request)
    expect(request.requested).toBe(true)
    const relaunch = vi.fn()
    const exit = vi.fn()
    finishCheckDuePass({ relaunch, exit }, ['out/main/index.js', '--check-due'], request, 0)
    expect(relaunch).toHaveBeenCalledWith({ args: ['out/main/index.js'] })
    expect(exit).toHaveBeenCalledWith(0)
  })

  test('the window relaunch drops the Linux job switches so it opens on the display', () => {
    const request = createCheckDueLaunchRequest()
    noteCheckDueActivate(request)
    const relaunch = vi.fn()
    const exit = vi.fn()
    const argv = ['--check-due', '--ozone-platform=headless', '--disable-gpu']
    finishCheckDuePass({ relaunch, exit }, argv, request, 0)
    expect(relaunch).toHaveBeenCalledWith({ args: [] })
    expect(exit).toHaveBeenCalledWith(0)
  })

  test('the pass stops after the running page so the window opens without a long wait', async () => {
    const request = createCheckDueLaunchRequest()
    const runner = fixtureCheckRunner(() => {
      noteCheckDueSecondInstance(request, ['CiteFox'])
      return { outcome: 'ok', searches: [] }
    })
    const code = await runCheckDueCommand({
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner,
      catalog: {
        app: defaultAppSchedule(),
        projects: [
          {
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
        ],
        pages: ['page-1', 'page-2'].map((pageId) => ({
          projectId: 'proj-1',
          pageId,
          label: pageId,
          title: pageId,
          url: `https://textbolt.com/${pageId}`,
          status: 'tracked' as const,
          intervalDays: 14 as const,
          promptSetVersion: null,
          markets: [
            { marketId: 'us', lastCheckedAt: '2026-04-01T08:00:00.000Z', firstCheckNotBefore: null }
          ]
        }))
      },
      shouldStop: () => request.requested
    })
    expect(code).toBe(0)
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1'])
  })
})
