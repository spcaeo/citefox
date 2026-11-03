import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RETRY_DELAY_CAP_MS } from '../providers/retry'
import { createCheckQueue } from '../queue/check-queue'
import { fixtureCheckRunner } from '../queue/runner'
import type { QueueKeyInput, QueueProjectInput } from '../queue/types'
import { manualClock } from '../scheduler/clock'
import type { AppSchedule, ScheduledPageInput, ScheduledProjectInput } from '../scheduler/types'
import { defaultAppSchedule } from '../storage/settings'
import {
  CHECK_DUE_EXIT_CAP,
  CHECK_DUE_EXIT_ERROR,
  CHECK_DUE_EXIT_OK,
  isCheckDueFlag,
  memoryDuePassStore,
  runCheckDue,
  runCheckDueCommand,
  shouldSkipForRunningInstance
} from './index'

const CHECKED = Date.parse('2026-04-06T08:00:00.000Z')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('citefox --check-due', () => {
  test('exits 0 when nothing is due and does not read Date.now', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now')
    })
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const result = await runCheckDue({
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner,
      catalog: catalog([])
    })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(result.stop).toBe('nothing_due')
    expect(result.pass).toEqual({ started: true, jobIds: [], pages: 0 })
    expect(runner.jobs).toEqual([])
  })

  test('the command exits 0 when no catalog is injected', async () => {
    await expect(runCheckDueCommand()).resolves.toBe(CHECK_DUE_EXIT_OK)
  })

  test('runs a due page and does nothing the second time that local day', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [{ slotId: 's1' }] }))
    const first = await runCheckDue(pass(clock, runner, queue))
    const second = await runCheckDue(pass(clock, runner, queue))
    expect(first.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(first.pass.started).toBe(true)
    expect(first.pass.pages).toBe(1)
    expect(second).toMatchObject({
      exitCode: CHECK_DUE_EXIT_OK,
      stop: 'already_ran',
      pass: { started: false, jobIds: first.pass.jobIds, pages: 1 }
    })
    expect(runner.jobs).toHaveLength(1)
    expect(queue.status().keys[0]?.used).toBe(1)
  })

  test('exits 1 when a page check fails and redacts secrets', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    const runner = fixtureCheckRunner(() => ({
      outcome: 'error',
      message: `boom ${secret}`,
      searches: []
    }))
    const result = await runCheckDue({ ...pass(clock, runner, queue), secrets: [secret] })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_ERROR)
    expect(result.stop).toBe('error')
    expect(result.errorMessage).not.toContain(secret)
    expect(result.errorMessage).toContain('[REDACTED]')
    expect(queue.status().running).toBe(0)
  })

  test('a runner error logged through applyCheckResult never contains the planted API key', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const secret = 'citefox-planted-api-key-9f3a7c'
    const lines: string[] = []
    const runner = fixtureCheckRunner(() => ({
      outcome: 'error',
      message: `provider rejected key ${secret} for this page`,
      searches: []
    }))
    const result = await runCheckDue({
      ...pass(clock, runner, queue),
      secrets: [secret],
      logger: {
        error(message, extra) {
          lines.push(`${message} ${JSON.stringify(extra)}`)
        }
      }
    })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_ERROR)
    expect(result.errorMessage).toContain('[REDACTED]')
    expect(result.errorMessage).not.toContain(secret)
    const logged = lines.join('\n')
    expect(logged).toContain('Page check failed')
    expect(logged).toContain('[REDACTED]')
    expect(logged).not.toContain(secret)
  })

  test('a cancelled page is skipped and the other due pages still run', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const passStore = memoryDuePassStore()
    const lines: string[] = []
    const runner = fixtureCheckRunner((job) =>
      job.pageId === 'page-1'
        ? { outcome: 'error', message: 'Check cancelled.', searches: [] }
        : { outcome: 'ok', searches: [] }
    )
    const catalog = twoPages()
    const first = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog,
      passStore,
      logger: {
        error(message) {
          lines.push(message)
        }
      }
    })
    expect(first).toMatchObject({
      exitCode: CHECK_DUE_EXIT_OK,
      stop: 'finished',
      errorMessage: null
    })
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1', 'page-2'])
    expect(lines).toEqual([])
    expect(queue.status()).toMatchObject({ running: 0, waiting: 0 })
    const second = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog,
      passStore
    })
    expect(second).toMatchObject({ exitCode: CHECK_DUE_EXIT_OK, stop: 'already_ran' })
    expect(runner.jobs).toHaveLength(2)
  })

  test('a later page failure still exits 1 after a cancel', async () => {
    const runner = fixtureCheckRunner((job) =>
      job.pageId === 'page-1'
        ? { outcome: 'error', message: 'Check cancelled.', searches: [] }
        : { outcome: 'error', message: 'boom', searches: [] }
    )
    const result = await runCheckDue({
      ...pass(manualClock(NOON), runner),
      catalog: twoPages()
    })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_ERROR)
    expect(result.stop).toBe('error')
    expect(result.errorMessage).toBe('boom')
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1', 'page-2'])
  })

  test('a paused queue does not run and does not consume the day', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const passStore = memoryDuePassStore()
    queue.pause('all')
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const held = await runCheckDue({ ...pass(clock, runner, queue), passStore })
    expect(held).toMatchObject({ exitCode: CHECK_DUE_EXIT_OK, stop: 'paused' })
    expect(runner.jobs).toEqual([])
    expect(passStore.read()).toBeNull()
    queue.resume()
    const after = await runCheckDue({ ...pass(clock, runner, queue), passStore })
    expect(after.pass.started).toBe(true)
    expect(runner.jobs).toHaveLength(1)
    expect(passStore.read()).toMatchObject({ day: '2026-04-20', pages: 1 })
  })

  test('an empty catalog does not write a day pass, and a page set up later still starts', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const passStore = memoryDuePassStore()
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const empty = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog: catalog([]),
      passStore
    })
    expect(empty).toMatchObject({
      exitCode: CHECK_DUE_EXIT_OK,
      stop: 'nothing_due',
      pass: { started: true, jobIds: [], pages: 0 }
    })
    expect(passStore.read()).toBeNull()
    expect(runner.jobs).toEqual([])

    const fresh = page({
      status: 'setting_up',
      promptSetVersion: 1,
      markets: [{ marketId: 'us', lastCheckedAt: null, firstCheckNotBefore: null }]
    })
    const started = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog: catalog([fresh]),
      passStore
    })
    expect(started.pass.started).toBe(true)
    expect(started.pass.pages).toBe(1)
    expect(started.stop).not.toBe('already_ran')
    expect(runner.jobs).toHaveLength(1)
    expect(passStore.read()).toMatchObject({ day: '2026-04-20', pages: 1 })

    const third = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog: catalog([fresh]),
      passStore
    })
    expect(third).toMatchObject({
      exitCode: CHECK_DUE_EXIT_OK,
      stop: 'already_ran',
      pass: { started: false, pages: 1 }
    })
    expect(runner.jobs).toHaveLength(1)
  })

  test('a page added after a completed pass still starts, and the first page does not run twice', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const passStore = memoryDuePassStore()
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const firstPage = page({
      status: 'setting_up',
      promptSetVersion: 1,
      markets: [{ marketId: 'us', lastCheckedAt: null, firstCheckNotBefore: null }]
    })
    const first = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog: catalog([firstPage]),
      passStore
    })
    expect(first.pass.started).toBe(true)
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1'])

    const secondPage = page({
      status: 'setting_up',
      promptSetVersion: 1,
      pageId: 'page-2',
      label: 'Other',
      title: 'Other',
      url: 'https://textbolt.com/other',
      markets: [{ marketId: 'us', lastCheckedAt: null, firstCheckNotBefore: null }]
    })
    const second = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog: catalog([firstPage, secondPage]),
      passStore
    })
    expect(second.pass.started).toBe(true)
    expect(second.pass.pages).toBe(1)
    expect(second.stop).not.toBe('already_ran')
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1', 'page-2'])

    const third = await runCheckDue({
      ...pass(clock, runner, queue),
      catalog: catalog([firstPage, secondPage]),
      passStore
    })
    expect(third.stop).toBe('already_ran')
    expect(third.pass.started).toBe(false)
    expect(runner.jobs).toHaveLength(2)
  })

  test('a shared day-pass store stops a second queue from enqueueing', async () => {
    const clock = manualClock(NOON)
    const passStore = memoryDuePassStore()
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const first = await runCheckDue({ ...pass(clock, runner, openQueue(clock)), passStore })
    expect(first.pass.started).toBe(true)
    const secondQueue = openQueue(clock)
    const second = await runCheckDue({ ...pass(clock, runner, secondQueue), passStore })
    expect(second).toMatchObject({
      exitCode: CHECK_DUE_EXIT_OK,
      stop: 'already_ran',
      pass: { started: false, jobIds: first.pass.jobIds, pages: 1 }
    })
    expect(secondQueue.status().waiting).toBe(0)
    expect(runner.jobs).toHaveLength(1)
  })

  test('a page error and a cap stop exit 2', async () => {
    const runner = fixtureCheckRunner((job) =>
      job.pageId === 'page-1'
        ? { outcome: 'error', message: 'boom', searches: [] }
        : { outcome: 'ok', searches: [] }
    )
    const result = await runCheckDue({
      ...pass(manualClock(NOON), runner),
      catalog: catalog([
        page(),
        page({
          pageId: 'page-2',
          label: 'Other',
          title: 'Other',
          url: 'https://textbolt.com/other'
        })
      ]),
      queueProjects: [queueProject({ cap: 0, capRule: 'pause' })],
      estimateSearches: (due) => (due.pageId === 'page-1' ? 0 : 1)
    })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_CAP)
    expect(result.stop).toBe('cap')
    expect(result.capRule).toBe('pause')
    expect(result.errorMessage).toBe('boom')
    expect(runner.jobs.map((job) => job.pageId)).toEqual(['page-1'])
  })

  test('the caps ledger honours a month-to-date usage seed and stays empty by default', async () => {
    const row = { keyId: 'key-1', projectId: 'proj-1', month: '2026-04', searches: 10 }
    const open = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [{ slotId: 's1' }] }))
    const openRun = await runCheckDue({
      ...pass(manualClock(NOON), open),
      queueProjects: [queueProject({ cap: 10, capRule: 'pause' })],
      estimateSearches: () => 1
    })
    expect(openRun.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(open.jobs).toHaveLength(1)

    const blockedRunner = fixtureCheckRunner(() => ({
      outcome: 'ok',
      searches: [{ slotId: 's1' }]
    }))
    const blocked = await runCheckDue({
      ...pass(manualClock(NOON), blockedRunner),
      queueProjects: [queueProject({ cap: 10, capRule: 'pause' })],
      estimateSearches: () => 1,
      usageSeedStore: { monthToDate: () => [row] }
    })
    expect(blocked.exitCode).toBe(CHECK_DUE_EXIT_CAP)
    expect(blocked.stop).toBe('cap')
    expect(blockedRunner.jobs).toEqual([])

    const seeded = createCheckQueue({
      clock: manualClock(NOON),
      timeZone: 'UTC',
      keys: [searchKey()],
      projects: [queueProject({ cap: 10, capRule: 'pause' })],
      usageSeed: [row]
    })
    expect(seeded.status().projects[0]?.used).toBe(10)
    expect(seeded.status().keys[0]?.used).toBe(10)
    const fresh = createCheckQueue({
      clock: manualClock(NOON),
      timeZone: 'UTC',
      keys: [searchKey()],
      projects: [queueProject({ cap: 10, capRule: 'pause' })]
    })
    expect(fresh.status().projects[0]?.used).toBe(0)
    expect(fresh.status().keys[0]?.used).toBe(0)
  })

  test('a paused project and a paused page are not checked', async () => {
    const clock = manualClock(NOON)
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const pausedProject = await runCheckDue({
      ...pass(clock, runner),
      catalog: catalog([page()], [project({ paused: true })])
    })
    const pausedPage = await runCheckDue({
      ...pass(clock, runner),
      catalog: catalog([page({ status: 'paused' })])
    })
    expect(pausedProject.pass.pages).toBe(0)
    expect(pausedPage.pass.pages).toBe(0)
    expect(runner.jobs).toEqual([])
    expect(pausedProject.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(pausedPage.exitCode).toBe(CHECK_DUE_EXIT_OK)
  })

  test('an archived project is not checked', async () => {
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const result = await runCheckDue({
      ...pass(manualClock(NOON), runner),
      catalog: catalog([page()], [project({ archived: true })])
    })
    expect(result.pass.pages).toBe(0)
    expect(runner.jobs).toEqual([])
  })

  test('quiet hours hold the page, and 08:00–08:00 means off', async () => {
    const waits: number[] = []
    const clock = manualClock(NOON)
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const quiet = await runCheckDue({
      ...pass(clock, runner),
      catalog: catalog([page()], [project({ quietFrom: '11:00', quietUntil: '13:00' })]),
      sleep: async (ms) => {
        waits.push(ms)
        clock.set(clock.now() + ms)
      }
    })
    expect(quiet.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(waits).toEqual([60 * 60 * 1000])
    expect(runner.jobs).toHaveLength(1)
    expect(clock.now()).toBe(Date.parse('2026-04-20T13:00:00.000Z'))

    const overnight = manualClock(Date.parse('2026-04-20T22:30:00.000Z'))
    const held = await runCheckDue({
      ...pass(overnight, runner),
      catalog: catalog([page()], [project({ quietFrom: '22:00', quietUntil: '07:00' })])
    })
    expect(held.pass.pages).toBe(0)
    expect(runner.jobs).toHaveLength(1)

    const off = await runCheckDue({
      ...pass(manualClock(NOON), runner),
      catalog: catalog([page()], [project({ quietFrom: '08:00', quietUntil: '08:00' })])
    })
    expect(off.pass.pages).toBe(1)
    expect(off.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toHaveLength(2)
  })

  test('pause and notify stop at the cap, allow_10 stops only past the extra tenth', async () => {
    const pause = await capped('pause', 11)
    expect(pause.result.exitCode).toBe(CHECK_DUE_EXIT_CAP)
    expect(pause.result.capRule).toBe('pause')
    expect(pause.result.alerts).toEqual([])
    expect(pause.runner.jobs).toEqual([])

    const notify = await capped('notify', 11)
    expect(notify.result.exitCode).toBe(CHECK_DUE_EXIT_CAP)
    expect(notify.result.capRule).toBe('notify')
    expect(notify.result.alerts).toHaveLength(1)
    expect(notify.result.alerts[0]).toMatchObject({ projectId: 'proj-1', cap: 10, used: 0 })
    expect(notify.runner.jobs).toEqual([])

    const within = await capped('allow_10', 11)
    expect(within.result.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(within.runner.jobs).toHaveLength(1)
    expect(within.result.alerts).toEqual([])

    const over = await capped('allow_10', 12)
    expect(over.result.exitCode).toBe(CHECK_DUE_EXIT_CAP)
    expect(over.result.capRule).toBe('allow_10')
    expect(over.runner.jobs).toEqual([])
    expect(over.result.alerts).toEqual([])
  })

  test('requeues a rate-limited page and honours Retry-After, capped at 30 seconds', async () => {
    const clock = manualClock(NOON)
    const queue = openQueue(clock)
    const sleeps: number[] = []
    const runner = fixtureCheckRunner((_job, attempt) =>
      attempt === 1
        ? { outcome: 'rate_limited', retryAfter: '120', searches: [] }
        : { outcome: 'ok', searches: [{ slotId: 's1' }] }
    )
    const result = await runCheckDue({
      ...pass(clock, runner, queue),
      sleep: async (ms) => {
        sleeps.push(ms)
        clock.set(clock.now() + ms)
      }
    })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(sleeps).toEqual([RETRY_DELAY_CAP_MS])
    expect(runner.jobs).toHaveLength(2)
    expect(queue.status().keys[0]?.used).toBe(1)

    const plain = manualClock(NOON)
    const plainSleeps: number[] = []
    const plainRunner = fixtureCheckRunner((_job, attempt) =>
      attempt === 1 ? { outcome: 'rate_limited', searches: [] } : { outcome: 'ok', searches: [] }
    )
    await runCheckDue({
      ...pass(plain, plainRunner),
      sleep: async (ms) => {
        plainSleeps.push(ms)
        plain.set(plain.now() + ms)
      }
    })
    expect(plainSleeps).toEqual([200])
  })

  test('never opens a window', async () => {
    const opened = vi.fn()
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const result = await runCheckDue({ ...pass(manualClock(NOON), runner), openWindow: opened })
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(opened).not.toHaveBeenCalled()
    const headless = readFileSync(new URL('./check-due.ts', import.meta.url), 'utf8')
    const barrel = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(headless.includes("from 'electron'")).toBe(false)
    expect(headless.includes('createMainWindow')).toBe(false)
    expect(barrel.includes("from 'electron'")).toBe(false)
    const main = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const ready = main.indexOf('.whenReady()')
    // The startup decision (after the app is ready); the crash guard above it also reads the flag.
    const flag = main.indexOf('isCheckDueFlag(process.argv)', ready)
    const skip = main.indexOf('shouldSkipForRunningInstance(app)')
    const note = main.indexOf('noteCheckDueSecondInstance(launchRequest, argv)')
    const dock = main.indexOf('app.dock?.hide()')
    const lock = main.indexOf('acquirePrimaryInstance(app)')
    const focus = main.indexOf('handleSecondInstance(argv')
    const storageOpen = main.indexOf('openAppStorage(')
    // The engine is built once, wrapped so alert rules run after each job (Alerts & schedules › Alert rules);
    // the same alert service sends the daily digests (timer, and after --check-due's checks).
    const built = main.indexOf(
      'const checkEngine = withAlertRules(createCheckEngine(deps), alertRules)'
    )
    const run = main.indexOf('runCheckDueCommand({')
    const close = main.indexOf('appStorage.close()')
    const finish = main.indexOf(
      'finishCheckDuePass(app, process.argv.slice(1), launchRequest, code, logger)'
    )
    const bind = main.indexOf('bindScheduleQueueTray({')
    const windowCall = main.indexOf('await createMainWindow')
    expect(ready).toBeGreaterThan(-1)
    expect(flag).toBeGreaterThan(ready)
    expect(skip).toBeGreaterThan(flag)
    expect(lock).toBeGreaterThan(skip)
    expect(note).toBeGreaterThan(lock)
    expect(dock).toBeGreaterThan(note)
    expect(focus).toBeGreaterThan(dock)
    expect(storageOpen).toBeGreaterThan(focus)
    expect(built).toBeGreaterThan(storageOpen)
    expect(main.indexOf('createCheckEngine(deps)', built + 60)).toBe(-1)
    const runnerLine = '\n    const checkRunner = createCheckRunner(deps, checkEngine)\n\n'
    const runnerAt = main.indexOf(runnerLine, built)
    expect(runnerAt).toBeGreaterThan(built)
    // Nothing but the alert-rules wrapper sits between the engine and its runner.
    expect(main.slice(built, runnerAt).includes('const ')).toBe(true)
    expect(main.slice(built + 1, runnerAt).match(/\n {4}const /g)).toBeNull()
    const headlessBlock = main.slice(
      main.indexOf('if (headless) {'),
      main.indexOf('installContentGuards()')
    )
    expect(headlessBlock.includes('resumeInterruptedChecks')).toBe(false)
    const resumeAt = main.indexOf('resumeInterruptedChecks(checkEngine)')
    expect(resumeAt).toBeGreaterThan(finish)
    expect(resumeAt).toBeLessThan(windowCall)
    expect(run).toBeGreaterThan(built)
    expect(main.indexOf('runner: checkRunner', run)).toBeGreaterThan(run)
    expect(main.indexOf('runner: checkRunner', run)).toBeLessThan(bind)
    expect(close).toBeGreaterThan(run)
    expect(main.indexOf('appStorage.close()', close + 1)).toBe(-1)
    const headlessPass = main.slice(main.indexOf('if (headless) {'), finish)
    const finallyAt = headlessPass.indexOf('} finally {')
    expect(finallyAt).toBeGreaterThan(-1)
    expect(headlessPass.indexOf('appStorage.close()')).toBeGreaterThan(finallyAt)
    expect(headlessPass.slice(finallyAt).includes('code =')).toBe(false)
    expect(finish).toBeGreaterThan(close)
    expect(bind).toBeGreaterThan(finish)
    expect(main.indexOf('runner: checkRunner', bind)).toBeGreaterThan(bind)
    expect(windowCall).toBeGreaterThan(bind)
    expect(main.includes('if (!headless && !acquirePrimaryInstance(app)) return')).toBe(true)
    expect(main.includes('app.exit(CHECK_DUE_EXIT_ERROR)')).toBe(true)
    expect(main.includes('} else {')).toBe(false)
    expect(headless.includes('function defaultAppSchedule')).toBe(false)
  })

  test('skips the pass when another instance holds the single-instance lock', () => {
    let calls = 0
    expect(
      shouldSkipForRunningInstance({
        requestSingleInstanceLock: () => {
          calls += 1
          return false
        }
      })
    ).toBe(true)
    expect(
      shouldSkipForRunningInstance({
        requestSingleInstanceLock: () => {
          calls += 1
          return true
        }
      })
    ).toBe(false)
    expect(calls).toBe(2)
  })

  test('recognises the flag and ignores a lookalike', () => {
    expect(isCheckDueFlag(['citefox', '--check-due'])).toBe(true)
    expect(isCheckDueFlag(['citefox', '--check-due-now'])).toBe(false)
  })
})

async function capped(
  capRule: QueueProjectInput['capRule'],
  maxSearches: number
): Promise<{
  result: Awaited<ReturnType<typeof runCheckDue>>
  runner: ReturnType<typeof fixtureCheckRunner>
}> {
  const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
  const result = await runCheckDue({
    ...pass(manualClock(NOON), runner),
    queueProjects: [queueProject({ cap: 10, capRule })],
    keys: [searchKey()],
    estimateSearches: () => maxSearches
  })
  return { result, runner }
}

function pass(
  clock: ReturnType<typeof manualClock>,
  runner: ReturnType<typeof fixtureCheckRunner>,
  queue?: ReturnType<typeof createCheckQueue>
): Parameters<typeof runCheckDue>[0] {
  return {
    clock,
    timeZone: 'UTC',
    runner,
    catalog: catalog(),
    queue,
    keys: [searchKey()],
    queueProjects: [queueProject()]
  }
}

function openQueue(clock: ReturnType<typeof manualClock>): ReturnType<typeof createCheckQueue> {
  return createCheckQueue({
    clock,
    timeZone: 'UTC',
    keys: [searchKey()],
    projects: [queueProject()]
  })
}

function twoPages(): ReturnType<typeof catalog> {
  return catalog([
    page(),
    page({
      pageId: 'page-2',
      label: 'Other',
      title: 'Other',
      url: 'https://textbolt.com/other'
    })
  ])
}

function catalog(
  pages: readonly ScheduledPageInput[] = [page()],
  projects: readonly ScheduledProjectInput[] = [project()],
  app: AppSchedule = defaultAppSchedule()
): {
  app: AppSchedule
  projects: readonly ScheduledProjectInput[]
  pages: readonly ScheduledPageInput[]
} {
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
