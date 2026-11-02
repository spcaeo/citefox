import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { BuyerProfile, BuyerPrompt, PageSummary, ReportSchedule } from '@shared/domain'
import { MemoryDraftOpener } from '../email/draft'
import { accountBody } from '../email/harness'
import { createEmailService } from '../email/service'
import { createStorageEmailStores } from '../email/storage-stores'
import { MemorySmtpTransport } from '../email/transport'
import { MemoryWebhookTransport } from '../email/webhook'
import { createLogger } from '../logging/logger'
import { contentHash } from '../pipeline/hash'
import { fixtureCheckRunner } from '../queue/runner'
import type { RunningJob } from '../queue/types'
import { bindScheduleQueueTray } from '../scheduler/ipc'
import { manualClock } from '../scheduler/clock'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage } from '../storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type NewPromptSet,
  type StoredSnapshot
} from '../storage/content-records'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { getDayPass } from '../storage/day-pass'
import { createFixFollowUp, listFixFollowUps, setFixFollowUpRun } from '../storage/fix-follow-ups'
import {
  addPageMarket,
  getPageMarketLastCheckedAt,
  insertPage,
  setPageMarketFirstCheckNotBefore,
  setPageMarketLastCheckedAt
} from '../storage/pages'
import { setQueuePause } from '../storage/queue-pause'
import { appDataPaths } from '../storage/paths'
import { createProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { insertMarket, writeProjectProfile } from '../storage/project-profile'
import {
  defaultProjectSchedule,
  writeProjectSchedule,
  writeProjectScheduleCap,
  type ProjectScheduleCap
} from '../storage/project-schedule'
import {
  insertApiKey,
  insertKeyUsage,
  insertProject,
  type ApiKeyRecord,
  type ProjectRecord
} from '../storage/records'
import { readAppSchedule, writeAppSchedule } from '../storage/settings'
import { projectDatabaseRelativePath } from '../storage/slug'
import { listRecentTrayChecks } from '../storage/tray-history'
import { CHECK_DUE_EXIT_CAP, CHECK_DUE_EXIT_ERROR, CHECK_DUE_EXIT_OK } from './check-due'
import { openCheckDueStorage, recordStoredCheck, runCheckDueCommand } from './storage-pass'

const NOON = Date.parse('2026-04-20T12:00:00.000Z')
const FINISHED = '2026-04-20T12:00:00.000Z'
const MISSED = '2026-03-21T08:00:00.000Z'
const dirs: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('check-due storage', () => {
  test('the stored app schedule defaults startAtLogin to true (SRS section 8)', () => {
    const dir = emptyDir()
    const opened = openCheckDueStorage({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC'
    })
    expect(opened.catalog.app).toEqual({
      startAtLogin: true,
      catchUpAfterSleep: true,
      checkWhenClosed: false,
      dailyCheckTime: '08:00'
    })
    expect(readAppSchedule(appDataPaths(dir).settingsFile).startAtLogin).toBe(true)
    opened.close()
  })

  test('a due page is checked once, then last_checked_at, tray history, and the day pass are stored', async () => {
    const dir = seedProject({ score: 80 })
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const clock = manualClock(NOON)
    const first = await runCheckDueCommand({
      userData: dir,
      clock,
      timeZone: 'UTC',
      runner
    })
    const second = await runCheckDueCommand({
      userData: dir,
      clock,
      timeZone: 'UTC',
      runner
    })

    expect(first).toBe(CHECK_DUE_EXIT_OK)
    expect(second).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toHaveLength(1)
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(FINISHED)
    expect(listRecentTrayChecks(appDb(dir))).toEqual([
      {
        projectId: 'proj-1',
        pageId: 'page-1',
        label: 'Alerts',
        score: 80,
        change: null,
        finishedAt: FINISHED
      }
    ])
    expect(getDayPass(appDb(dir), '2026-04-20')).toMatchObject({
      day: '2026-04-20',
      pages: 1
    })
  })

  test('tray history uses the page URL when the label and title are missing', () => {
    const dir = seedProject({ score: 80 })
    const db = projectDb(dir)
    db.prepare(`UPDATE pages SET label = NULL, title = NULL WHERE id = ?`).run('page-1')
    const storage = openAppStorage(dir)
    databases.push(storage.db)
    recordStoredCheck(storage, checkedJob(), FINISHED)
    expect(listRecentTrayChecks(storage.db)).toEqual([
      {
        projectId: 'proj-1',
        pageId: 'page-1',
        label: 'https://textbolt.com/text-alerts',
        score: 80,
        change: null,
        finishedAt: FINISHED
      }
    ])
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(FINISHED)
  })

  test('a missing page still updates last_checked_at and writes no tray row', () => {
    const dir = seedProject({})
    const db = projectDb(dir)
    db.pragma('foreign_keys = OFF')
    db.prepare(`DELETE FROM pages WHERE id = ?`).run('page-1')
    db.pragma('foreign_keys = ON')
    const storage = openAppStorage(dir)
    databases.push(storage.db)
    recordStoredCheck(storage, checkedJob(), FINISHED)
    expect(listRecentTrayChecks(storage.db)).toEqual([])
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(FINISHED)
  })

  test('a failed page check does not mark the market checked or append tray history', async () => {
    const dir = seedProject({})
    const runner = fixtureCheckRunner(() => ({ outcome: 'error', message: 'boom', searches: [] }))
    const code = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner
    })
    expect(code).toBe(CHECK_DUE_EXIT_ERROR)
    expect(runner.jobs).toHaveLength(1)
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBeNull()
    expect(listRecentTrayChecks(appDb(dir))).toEqual([])
  })

  test('a cancelled page is not marked checked, writes no tray row, and sits out the day', async () => {
    const dir = seedProject({})
    const runner = fixtureCheckRunner(() => ({
      outcome: 'error',
      message: 'Check cancelled.',
      searches: []
    }))
    const clock = manualClock(NOON)
    const first = await runCheckDueCommand({
      userData: dir,
      clock,
      timeZone: 'UTC',
      runner
    })
    const second = await runCheckDueCommand({
      userData: dir,
      clock,
      timeZone: 'UTC',
      runner
    })
    expect(first).toBe(CHECK_DUE_EXIT_OK)
    expect(second).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toHaveLength(1)
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBeNull()
    expect(listRecentTrayChecks(appDb(dir))).toEqual([])
  })

  test('the stored schedule decides whether a missed page runs now or waits for the daily check', async () => {
    const caughtUp = seedProject({ lastCheckedAt: MISSED, dailyCheckTime: '23:00' })
    const caughtUpRunner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const caughtUpWaits: number[] = []
    const caughtUpCode = await runCheckDueCommand({
      userData: caughtUp,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: caughtUpRunner,
      sleep: async (ms) => {
        caughtUpWaits.push(ms)
      }
    })
    expect(caughtUpCode).toBe(CHECK_DUE_EXIT_OK)
    expect(caughtUpWaits).toEqual([])
    expect(caughtUpRunner.jobs).toHaveLength(1)
    expect(getPageMarketLastCheckedAt(projectDb(caughtUp), 'page-1', 'mkt-us')).toBe(FINISHED)

    const dir = seedProject({
      lastCheckedAt: MISSED,
      dailyCheckTime: '23:00',
      schedule: {
        startAtLogin: false,
        catchUpAfterSleep: false,
        checkWhenClosed: false,
        dailyCheckTime: '08:00'
      }
    })
    const opened = openCheckDueStorage({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC'
    })
    expect(opened.catalog.app).toMatchObject({ startAtLogin: false, catchUpAfterSleep: false })
    opened.close()

    const clock = manualClock(NOON)
    const waits: number[] = []
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const code = await runCheckDueCommand({
      userData: dir,
      clock,
      timeZone: 'UTC',
      runner,
      sleep: async (ms) => {
        waits.push(ms)
        clock.set(clock.now() + ms)
      }
    })
    // The headless job does not sleep for eleven hours holding the app lock.
    // It exits, and the OS job's 23:00 run checks the page.
    const heldUntil = Date.parse('2026-04-20T23:00:00.000Z')
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(waits).toEqual([])
    expect(runner.jobs).toHaveLength(0)
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(MISSED)
    clock.set(heldUntil)
    const later = await runCheckDueCommand({ userData: dir, clock, timeZone: 'UTC', runner })
    expect(later).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toHaveLength(1)
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(
      '2026-04-20T23:00:00.000Z'
    )
  })

  test('a pause made in the app holds the headless job, and pause today ends at midnight', async () => {
    const dir = seedProject({ lastCheckedAt: MISSED })
    const storage = openAppStorage(dir)
    setQueuePause(storage.db, { state: 'paused_today', day: '2026-04-20' })
    storage.close()
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const held = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner
    })
    expect(held).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toHaveLength(0)
    const nextDay = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(Date.parse('2026-04-21T09:00:00.000Z')),
      timeZone: 'UTC',
      runner
    })
    expect(nextDay).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toHaveLength(1)
  })

  test('month-to-date key usage seeds the cap and exit 2 wins', async () => {
    const dir = seedProject({ searches: 10 })
    const opened = openCheckDueStorage({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC'
    })
    expect(opened.usageSeedStore.monthToDate()).toEqual([
      { keyId: 'key-1', projectId: 'proj-1', month: '2026-04', searches: 10 }
    ])
    opened.close()

    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [{ slotId: 's1' }] }))
    const code = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner,
      queueProjects: [
        {
          projectId: 'proj-1',
          name: 'TextBolt',
          cap: 10,
          capRule: 'pause',
          dedicatedKeyId: null,
          paused: false
        }
      ],
      estimateSearches: () => 1
    })
    expect(code).toBe(CHECK_DUE_EXIT_CAP)
    expect(runner.jobs).toEqual([])
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBeNull()
  })

  test('stored cap, stagger hold, and planned follow-ups replace the old defaults', () => {
    const dir = seedProject({
      lastCheckedAt: '2026-04-18T08:00:00.000Z',
      cap: { cap: 40, capRule: 'allow_10', dedicatedKeyId: 'key-1' },
      firstCheckNotBefore: '2026-04-25T00:00:00.000Z',
      followUps: [
        { id: 'fix-planned', goLiveAt: '2026-04-10T00:00:00.000Z' },
        { id: 'fix-done', goLiveAt: '2026-04-01T00:00:00.000Z', runId: 'run-done' }
      ]
    })
    const opened = openCheckDueStorage({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC'
    })
    expect(opened.queueProjects).toEqual([
      {
        projectId: 'proj-1',
        name: 'TextBolt',
        cap: 40,
        capRule: 'allow_10',
        dedicatedKeyId: 'key-1',
        paused: false,
        provider: 'auto'
      }
    ])
    expect(opened.catalog.pages[0]?.markets).toEqual([
      {
        marketId: 'mkt-us',
        lastCheckedAt: '2026-04-18T08:00:00.000Z',
        firstCheckNotBefore: '2026-04-25T00:00:00.000Z'
      }
    ])
    expect(opened.catalog.followUps).toEqual([
      {
        id: 'fix-planned',
        projectId: 'proj-1',
        pageId: 'page-1',
        description: 'Added a Saturday crew FAQ.',
        goLiveAt: '2026-04-10T00:00:00.000Z',
        rule: 'after_3_days',
        promptIds: ['prompt-1'],
        marketIds: ['mkt-us']
      }
    ])
    opened.close()
  })

  test('a future first-check hold keeps the page off this pass', async () => {
    const dir = seedProject({ firstCheckNotBefore: '2026-04-25T00:00:00.000Z' })
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [], runId: 'run-9' }))
    const code = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toEqual([])
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBeNull()
  })

  test('the stored project cap stops the pass', async () => {
    const dir = seedProject({
      searches: 10,
      cap: { cap: 10, capRule: 'pause', dedicatedKeyId: null }
    })
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [{ slotId: 's1' }] }))
    const code = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner,
      estimateSearches: () => 1
    })
    expect(code).toBe(CHECK_DUE_EXIT_CAP)
    expect(runner.jobs).toEqual([])
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBeNull()
  })

  test('a successful follow-up stores the runner run id and writes no verdict', async () => {
    const dir = seedProject({
      lastCheckedAt: '2026-04-18T08:00:00.000Z',
      followUps: [{ id: 'fix-planned', goLiveAt: '2026-04-10T00:00:00.000Z' }]
    })
    const runner = fixtureCheckRunner((job) => ({
      outcome: 'ok',
      searches: [],
      runId: job.fixId === 'fix-planned' ? 'run-9' : undefined
    }))
    const code = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs.map((job) => job.reason)).toEqual(['follow_up'])
    expect(runner.jobs[0]?.fixId).toBe('fix-planned')
    expect(listFixFollowUps(projectDb(dir), 'page-1')).toEqual([
      expect.objectContaining({
        id: 'fix-planned',
        followUpRunId: 'run-9',
        verdict: null,
        status: 'completed'
      })
    ])
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(FINISHED)
  })

  test('a success without a run id leaves the fix planned', async () => {
    const dir = seedProject({
      lastCheckedAt: '2026-04-18T08:00:00.000Z',
      followUps: [{ id: 'fix-planned', goLiveAt: '2026-04-10T00:00:00.000Z' }]
    })
    const code = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(listFixFollowUps(projectDb(dir), 'page-1')[0]).toMatchObject({
      status: 'planned',
      followUpRunId: null,
      verdict: null
    })
  })

  test('a failed follow-up leaves the fix planned and the market unchecked', async () => {
    const dir = seedProject({
      lastCheckedAt: '2026-04-18T08:00:00.000Z',
      followUps: [{ id: 'fix-planned', goLiveAt: '2026-04-10T00:00:00.000Z' }]
    })
    const code = await runCheckDueCommand({
      userData: dir,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: fixtureCheckRunner(() => ({
        outcome: 'error',
        message: 'boom',
        searches: []
      }))
    })
    expect(code).toBe(CHECK_DUE_EXIT_ERROR)
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(
      '2026-04-18T08:00:00.000Z'
    )
    expect(listFixFollowUps(projectDb(dir), 'page-1')[0]?.status).toBe('planned')
  })

  test('the in-app check completes a follow-up only when the runner returns a run id', async () => {
    const dir = seedProject({
      lastCheckedAt: '2026-04-18T08:00:00.000Z',
      followUps: [{ id: 'fix-planned', goLiveAt: '2026-04-10T00:00:00.000Z' }]
    })
    const storage = openAppStorage(dir)
    databases.push(storage.db)
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [], runId: 'run-app' }))
    const bound = bindScheduleQueueTray({
      now: () => new Date(NOON),
      timeZone: 'UTC',
      emit: () => undefined,
      claudeConcurrency: () => 2,
      keys: () => [],
      storage,
      runner
    })
    const first = await bound.queue.checkDue()
    const second = await bound.queue.checkDue()
    expect(first.started).toBe(true)
    expect(first.pages).toBe(1)
    expect(runner.jobs[0]?.fixId).toBe('fix-planned')
    expect(second).toEqual({ started: false, jobIds: first.jobIds, pages: 1 })
    expect(runner.jobs).toHaveLength(1)
    expect(listFixFollowUps(projectDb(dir), 'page-1')[0]).toMatchObject({
      followUpRunId: 'run-app',
      verdict: null,
      status: 'completed'
    })
    expect(getDayPass(storage.db, '2026-04-20')?.pages).toBe(1)

    const held = seedProject({
      lastCheckedAt: '2026-04-18T08:00:00.000Z',
      followUps: [{ id: 'fix-planned', goLiveAt: '2026-04-10T00:00:00.000Z' }]
    })
    const heldStorage = openAppStorage(held)
    databases.push(heldStorage.db)
    const unavailable = bindScheduleQueueTray({
      now: () => new Date(NOON),
      timeZone: 'UTC',
      emit: () => undefined,
      claudeConcurrency: () => 2,
      keys: () => [],
      storage: heldStorage
    })
    const missed = await unavailable.queue.checkDue()
    expect(missed.started).toBe(true)
    expect(listFixFollowUps(projectDb(held), 'page-1')[0]?.status).toBe('planned')
    expect(getPageMarketLastCheckedAt(projectDb(held), 'page-1', 'mkt-us')).toBe(
      '2026-04-18T08:00:00.000Z'
    )
  })

  test('a failed follow-up write rolls last_checked_at back and leaves the fix planned', () => {
    const previous = '2026-04-18T08:00:00.000Z'
    const dir = seedProject({
      lastCheckedAt: previous,
      followUps: [{ id: 'fix-planned', goLiveAt: '2026-04-10T00:00:00.000Z' }]
    })
    const storage = openAppStorage(dir)
    databases.push(storage.db)
    expect(() => recordStoredCheck(storage, followUpJob('fix-missing'), FINISHED, 'run-9')).toThrow(
      /Unknown follow-up/
    )
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(previous)
    expect(listFixFollowUps(projectDb(dir), 'page-1')[0]).toMatchObject({
      id: 'fix-planned',
      followUpRunId: null,
      status: 'planned'
    })
  })

  test('citefox --check-due does not deliver a deleted schedule', async () => {
    const when = '2026-02-04T12:00:00.000Z'
    const created = '2026-02-01T00:00:00.000Z'
    const dir = seedProject({ lastCheckedAt: when })
    const storage = openAppStorage(dir)
    databases.push(storage.db)
    let current = new Date(created)
    const clock = { now: () => current, timeZone: 'UTC' }
    const secrets = new MemorySecretStore()
    const stores = createStorageEmailStores({
      app: storage.db,
      projectsDirectory: storage.paths.projectsDirectory,
      outboxDir: join(storage.paths.root, 'outbox'),
      clock,
      logger: createLogger({ write: () => undefined })
    })
    try {
      const service = createEmailService({
        secrets,
        transport: new MemorySmtpTransport(),
        webhooks: new MemoryWebhookTransport(),
        drafts: new MemoryDraftOpener(),
        accounts: stores.accounts,
        alerts: stores.alerts,
        reports: stores.reports,
        deliveries: stores.deliveries,
        pdfs: stores.pdfs,
        logger: createLogger({ write: () => undefined }),
        clock,
        sleep: async () => undefined,
        createId: (() => {
          let n = 0
          return () => {
            n += 1
            return `id-${n}`
          }
        })()
      })
      service.saveAccount(accountBody())
      stores.reports.save(dueWeekly('sched-all', null, ['gone@example.com']))
      stores.reports.save(dueWeekly('sched-live', 'proj-1', ['live@example.com']))
      current = new Date(when)
      expect(stores.reports.delete(null, 'sched-all')).toBe(when)
      expect(stores.reports.list().map((row) => row.id)).toEqual(['sched-live'])
      expect(stores.reports.get('sched-all')).toBeNull()
    } finally {
      stores.close()
    }

    const transport = new MemorySmtpTransport()
    const code = await runCheckDueCommand({
      storage,
      clock: manualClock(Date.parse(when)),
      timeZone: 'UTC',
      runner: fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] })),
      reports: {
        secrets,
        transport,
        logger: createLogger({ write: () => undefined }),
        redacted: []
      }
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(transport.sent.map((item) => [...item.message.to])).toEqual([['live@example.com']])
    expect(
      storage.db
        .prepare<unknown[], { schedule_id: string | null }>(`SELECT schedule_id FROM deliveries`)
        .all()
        .map((row) => row.schedule_id)
    ).toEqual(['sched-live'])
  })
  test("a report with each project's default market attaches the file and the pass succeeds", async () => {
    // Live: a monthly/weekly PDF schedule saved with no market picked ("Each project's default
    // market") failed every --check-due with "Pick at least one market." and exit 1.
    const when = '2026-02-02T09:00:00.000Z'
    const dir = seedProject({ lastCheckedAt: when })
    const project = projectDb(dir)
    writeProjectProfile(project, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: [],
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
    const storage = openAppStorage(dir)
    databases.push(storage.db)
    const clock = { now: () => new Date('2026-02-01T00:00:00.000Z'), timeZone: 'UTC' }
    const secrets = new MemorySecretStore()
    const stores = createStorageEmailStores({
      app: storage.db,
      projectsDirectory: storage.paths.projectsDirectory,
      outboxDir: join(storage.paths.root, 'outbox'),
      clock,
      logger: createLogger({ write: () => undefined })
    })
    try {
      const service = createEmailService({
        secrets,
        transport: new MemorySmtpTransport(),
        webhooks: new MemoryWebhookTransport(),
        drafts: new MemoryDraftOpener(),
        accounts: stores.accounts,
        alerts: stores.alerts,
        reports: stores.reports,
        deliveries: stores.deliveries,
        pdfs: stores.pdfs,
        logger: createLogger({ write: () => undefined }),
        clock,
        sleep: async () => undefined
      })
      service.saveAccount(accountBody())
      stores.reports.save({
        ...dueWeekly('sched-csv', 'proj-1', ['me@example.com']),
        format: 'csv',
        marketIds: []
      })
    } finally {
      stores.close()
    }

    const transport = new MemorySmtpTransport()
    const code = await runCheckDueCommand({
      storage,
      clock: manualClock(Date.parse(when)),
      timeZone: 'UTC',
      runner: fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] })),
      reports: {
        secrets,
        transport,
        logger: createLogger({ write: () => undefined }),
        redacted: []
      }
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(transport.sent).toHaveLength(1)
    const attachment = transport.sent[0]?.message.attachment
    expect(attachment?.filename).toMatch(/\.zip$/)
    expect(attachment?.bytes.byteLength ?? 0).toBeGreaterThan(0)
  })
})

function dueWeekly(
  id: string,
  projectId: string | null,
  recipients: readonly string[]
): ReportSchedule {
  return {
    id,
    name: 'Monday report',
    projectId,
    timing: { kind: 'weekly', day: 1, time: '08:00' },
    format: 'summary',
    sections: [],
    marketIds: [],
    recipients,
    accountId: null,
    timeZone: 'UTC',
    subject: '{project}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z'
  }
}

function emptyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-check-due-'))
  dirs.push(dir)
  return dir
}

function seedProject(input: {
  score?: number | null
  lastCheckedAt?: string
  dailyCheckTime?: string
  searches?: number
  schedule?: {
    startAtLogin: boolean
    catchUpAfterSleep: boolean
    checkWhenClosed: boolean
    dailyCheckTime: string
  }
  cap?: ProjectScheduleCap
  firstCheckNotBefore?: string
  followUps?: readonly { id: string; goLiveAt: string; runId?: string }[]
}): string {
  const dir = emptyDir()
  const storage = openAppStorage(dir)
  insertProject(storage.db, projectRecord())
  if (input.searches !== undefined) {
    insertApiKey(storage.db, apiKey())
    insertKeyUsage(storage.db, {
      id: 'usage-1',
      keyId: 'key-1',
      projectId: 'proj-1',
      month: '2026-04',
      searches: input.searches,
      calls: 0,
      tokens: 0
    })
  }
  const project = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  insertMarket(project, {
    id: 'mkt-us',
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  })
  insertPage(project, samplePage(input.score ?? null))
  addPageMarket(project, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: '2026-04-01T08:00:00.000Z',
    baselineRunId: null
  })
  if (input.lastCheckedAt !== undefined) {
    setPageMarketLastCheckedAt(project, 'page-1', 'mkt-us', input.lastCheckedAt)
  }
  if (input.firstCheckNotBefore !== undefined) {
    setPageMarketFirstCheckNotBefore(project, 'page-1', 'mkt-us', input.firstCheckNotBefore)
  }
  if (input.followUps !== undefined) {
    seedPrompts(project)
    for (const fix of input.followUps) {
      createFixFollowUp(project, {
        id: fix.id,
        pageId: 'page-1',
        description: 'Added a Saturday crew FAQ.',
        goLiveAt: fix.goLiveAt,
        rule: 'after_3_days',
        promptIds: ['prompt-1'],
        marketIds: ['mkt-us']
      })
      if (fix.runId !== undefined) setFixFollowUpRun(project, fix.id, fix.runId)
    }
  }
  if (input.cap !== undefined) writeProjectScheduleCap(project, input.cap)
  if (input.dailyCheckTime !== undefined) {
    writeProjectSchedule(project, {
      ...defaultProjectSchedule('proj-1'),
      dailyCheckTime: input.dailyCheckTime
    })
  }
  if (input.schedule !== undefined) writeAppSchedule(storage.paths.settingsFile, input.schedule)
  closeDatabase(project)
  storage.close()
  return dir
}

function appDb(dir: string): SqliteDatabase {
  const storage = openAppStorage(dir)
  databases.push(storage.db)
  return storage.db
}

function projectDb(dir: string): SqliteDatabase {
  const db = openProjectDatabase(appDataPaths(dir).projectsDirectory, 'textbolt')
  databases.push(db)
  return db
}

function checkedJob(): RunningJob {
  return {
    id: 'job-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    marketIds: ['mkt-us'],
    reason: 'manual',
    promptIds: null,
    partial: false,
    needsClaude: false,
    maxSearches: 0,
    startedAt: FINISHED,
    cancelRequested: false
  }
}

function followUpJob(fixId: string): RunningJob {
  return {
    id: 'job-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    marketIds: ['mkt-us'],
    reason: 'follow_up',
    promptIds: ['prompt-1'],
    fixId,
    partial: true,
    needsClaude: false,
    maxSearches: 0,
    startedAt: FINISHED,
    cancelRequested: false
  }
}

function projectRecord(): ProjectRecord {
  return {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  }
}

function apiKey(): ApiKeyRecord {
  return {
    id: 'key-1',
    provider: 'serpapi',
    name: 'Primary',
    keychainRef: 'citefox.serpapi.key-1',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    hint: 'ab12',
    state: 'ok',
    lastReason: null,
    serpapiUsage: null
  }
}

const BODY = 'TextBolt page body'
const HASH = contentHash(BODY)
const TEMPLATE_HASH = contentHash('template body')

function seedPrompts(db: SqliteDatabase): void {
  insertSnapshot(db, {
    id: 'snap-page-1',
    pageId: 'page-1',
    fetchedAt: '2026-04-01T08:00:00.000Z',
    method: 'file',
    httpStatus: null,
    durationMs: 0,
    title: 'Alerts',
    metaDescription: null,
    h1: 'Alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: BODY,
    wordCount: 3,
    contentHash: HASH,
    summary: null
  } satisfies StoredSnapshot)
  insertBuyerProfile(db, {
    id: 'icp-page-1',
    pageId: 'page-1',
    snapshotId: 'snap-page-1',
    who: 'Office managers.',
    environment: 'They send email from scheduling tools.',
    segments: [],
    triggers: ['A missed weekend alert.'],
    values: ['Predictable pricing'],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: TEMPLATE_HASH,
    templateUpdatedAt: null,
    createdAt: '2026-04-01T08:00:00.000Z',
    promptsStale: false
  } satisfies BuyerProfile)
  const prompts: NewPromptSet = {
    id: 'pset-page-1',
    pageId: 'page-1',
    version: 1,
    savedAt: '2026-04-01T08:00:00.000Z',
    icpId: 'icp-page-1',
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: TEMPLATE_HASH,
    templateUpdatedAt: null,
    prompts: [buyerPrompt()]
  }
  insertPromptSet(db, prompts, ['TextBolt'])
}

function buyerPrompt(): BuyerPrompt {
  return {
    id: 'prompt-1',
    position: 1,
    label: 'Prompt 1',
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      {
        marketId: 'mkt-us',
        language: 'en',
        text: 'How do I handle a missed weekend alert on a Saturday morning?',
        originalText: null
      }
    ]
  }
}

function samplePage(score: number | null): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/text-alerts',
    title: 'Text alerts',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score,
    promptSetVersion: null
  }
}
