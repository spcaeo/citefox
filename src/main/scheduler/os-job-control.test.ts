import { describe, expect, test } from 'vitest'
import { IpcRequestError } from '../ipc-request'
import { defaultAppSchedule } from '../storage/settings'
import { manualClock } from './clock'
import { createScheduleHandlers } from './ipc'
import { createOsJobControl } from './os-job-control'
import { OsJobError, memoryOsJobInstaller, type OsJobInstaller } from './os-job'
import { createCheckSession, memoryScheduleStore } from './session'

const NOON = Date.parse('2026-04-20T12:00:00.000Z')

describe('the OS job behind "Also check when CiteFox is closed"', () => {
  test('turning it on installs the job for the check time; a new time reinstalls; off removes it', () => {
    const installer = memoryOsJobInstaller()
    const { schedule, session } = harness(installer)
    schedule.updateApp({ checkWhenClosed: true })
    expect(installer.spec).toMatchObject({
      program: '/Applications/CiteFox.app/Contents/MacOS/CiteFox',
      args: ['--check-due'],
      minute: 0
    })
    expect(session.osJob.registered).toBe(true)
    expect(session.queue.status().headlessJob).toBe(true)

    schedule.updateApp({ dailyCheckTime: '09:45' })
    expect(installer.spec?.minute).toBe(45)

    schedule.updateApp({ checkWhenClosed: false })
    expect(installer.spec).toBeNull()
    expect(session.osJob.registered).toBe(false)
    expect(session.queue.status().headlessJob).toBe(false)
  })

  test('a failed install says why and leaves the option off', () => {
    const installer: OsJobInstaller = {
      kind: 'launchd',
      install() {
        throw new OsJobError('launchctl refused the job. Restart the Mac and try again.')
      },
      remove() {
        // Nothing was installed.
      },
      isInstalled: () => false
    }
    const { schedule, session } = harness(installer)
    let caught: unknown
    try {
      schedule.updateApp({ checkWhenClosed: true })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(IpcRequestError)
    expect((caught as Error).message).toContain('launchctl refused the job')
    expect(schedule.getApp().checkWhenClosed).toBe(false)
    expect(session.osJob.registered).toBe(false)
  })

  test('on start the stored option follows what is really installed', () => {
    const missing = harness(memoryOsJobInstaller(), true)
    expect(missing.schedule.getApp().checkWhenClosed).toBe(false)
    expect(missing.session.osJob.registered).toBe(false)

    const installed = memoryOsJobInstaller()
    installed.install({
      program: '/Applications/CiteFox.app/Contents/MacOS/CiteFox',
      args: ['--check-due'],
      logDirectory: '/tmp/citefox-logs',
      minute: 0
    })
    const present = harness(installed, false)
    expect(present.schedule.getApp().checkWhenClosed).toBe(true)
    expect(present.session.queue.status().headlessJob).toBe(true)
  })
})

function harness(
  installer: OsJobInstaller,
  checkWhenClosed = false
): {
  schedule: ReturnType<typeof createScheduleHandlers>
  session: ReturnType<typeof createCheckSession>
} {
  const session = createCheckSession({
    clock: manualClock(NOON),
    timeZone: 'UTC',
    store: memoryScheduleStore({ app: { ...defaultAppSchedule(), checkWhenClosed } }),
    osJob: createOsJobControl({
      installer,
      specFor: (dailyCheckTime) => ({
        program: '/Applications/CiteFox.app/Contents/MacOS/CiteFox',
        args: ['--check-due'],
        logDirectory: '/tmp/citefox-logs',
        minute: Number(dailyCheckTime.slice(3))
      })
    })
  })
  return { schedule: createScheduleHandlers(session), session }
}
