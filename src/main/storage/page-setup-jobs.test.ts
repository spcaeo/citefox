import type { PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import {
  countSetupDoneSince,
  getPageSetupJob,
  listSetupCandidates,
  listSetupDoneSince,
  listSetupStartsSince,
  resetPageSetupJobs,
  writePageSetupJob,
  type PageSetupJob
} from './page-setup-jobs'
import { addPageMarket, insertPage, setPageMarketFirstCheckNotBefore } from './pages'
import { ensureProjectSchema, insertMarket } from './project-profile'
import {
  effectiveCapRule,
  readCapOverMonth,
  readEffectiveScheduleCap,
  writeCapOverMonth,
  writeProjectScheduleCap
} from './project-schedule'
import {
  DEFAULT_SETUP_PAGES_PER_HOUR,
  readSetupRunnerSettings,
  writeSetupRunnerSettings
} from './setup-runner-settings'
import { openAppDatabase } from './app-database'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('page setup jobs (project migration 024)', () => {
  test('lists only setting-up pages with their hold, tracked time, and runner row', () => {
    const db = projectDb()
    addPage(db, 'page-a', 'setting_up', '2026-10-19T10:00:00.000Z')
    addPage(db, 'page-b', 'setting_up', '2026-10-19T09:00:00.000Z')
    addPage(db, 'page-c', 'tracked', '2026-10-19T08:00:00.000Z')
    setPageMarketFirstCheckNotBefore(db, 'page-b', 'mkt-1', '2026-10-22T08:00:00.000Z')
    writePageSetupJob(db, job('page-a', { state: 'retry', attempts: 1 }))

    const candidates = listSetupCandidates(db)
    expect(candidates.map((item) => item.pageId)).toEqual(['page-a', 'page-b'])
    expect(candidates[0]).toMatchObject({
      hasSnapshot: false,
      hasProfile: false,
      promptSetVersion: null,
      trackedAt: '2026-10-19T10:00:00.000Z',
      firstCheckNotBefore: null,
      lastActivityAt: null,
      job: { state: 'retry', attempts: 1 }
    })
    expect(candidates[1]?.firstCheckNotBefore).toBe('2026-10-22T08:00:00.000Z')
    expect(candidates[1]?.job).toBeNull()
  })

  test('round-trips a row, redacts and clips its error, and resets failed pages for Retry', () => {
    const db = projectDb()
    addPage(db, 'page-a', 'setting_up', '2026-10-19T10:00:00.000Z')
    addPage(db, 'page-b', 'setting_up', '2026-10-19T10:00:00.000Z')
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
    writePageSetupJob(
      db,
      job('page-a', { state: 'failed', attempts: 4, lastError: `${secret} ${'x'.repeat(600)}` })
    )
    writePageSetupJob(db, job('page-b', { state: 'done', finishedAt: '2026-10-19T12:30:00.000Z' }))
    const stored = getPageSetupJob(db, 'page-a')
    expect(stored?.lastError).not.toContain(secret)
    expect(stored?.lastError?.length).toBeLessThanOrEqual(500)
    expect(countSetupDoneSince(db, '2026-10-19T00:00:00.000Z')).toBe(1)
    expect(countSetupDoneSince(db, '2026-10-20T00:00:00.000Z')).toBe(0)
    expect(listSetupDoneSince(db, '2026-10-19T00:00:00.000Z').map((row) => row.pageId)).toEqual([
      'page-b'
    ])
    expect(listSetupStartsSince(db, '2026-10-19T11:00:00.000Z')).toHaveLength(2)

    expect(resetPageSetupJobs(db, ['page-b'])).toBe(0)
    expect(resetPageSetupJobs(db, null)).toBe(1)
    expect(getPageSetupJob(db, 'page-a')).toBeNull()
    expect(getPageSetupJob(db, 'page-b')?.state).toBe('done')
    expect(() => writePageSetupJob(db, job('page-a', { attempts: -1 }))).toThrow()
  })

  test('a notify cap reads as allow_10 only in the month the user chose', () => {
    const db = projectDb()
    expect(readCapOverMonth(db)).toBeNull()
    writeCapOverMonth(db, '2026-10')
    expect(readCapOverMonth(db)).toBe('2026-10')
    writeProjectScheduleCap(db, { cap: 100, capRule: 'notify', dedicatedKeyId: null })
    expect(readEffectiveScheduleCap(db, '2026-10').capRule).toBe('allow_10')
    expect(readEffectiveScheduleCap(db, '2026-11').capRule).toBe('notify')
    expect(readCapOverMonth(db)).toBe('2026-10')
    expect(effectiveCapRule('pause', '2026-10', '2026-10')).toBe('pause')
    expect(() => writeCapOverMonth(db, '2026-13')).toThrow()
  })
})

describe('setup runner settings (app migration 021)', () => {
  test('defaults to running at the default rate and round-trips', () => {
    const db = openAppDatabase(':memory:')
    databases.push(db)
    expect(readSetupRunnerSettings(db)).toEqual({
      paused: false,
      pagesPerHour: DEFAULT_SETUP_PAGES_PER_HOUR
    })
    writeSetupRunnerSettings(db, { paused: true, pagesPerHour: 30 })
    expect(readSetupRunnerSettings(db)).toEqual({ paused: true, pagesPerHour: 30 })
    expect(() => writeSetupRunnerSettings(db, { paused: false, pagesPerHour: 0 })).toThrow()
  })
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  insertMarket(db, {
    id: 'mkt-1',
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  })
  return db
}

function addPage(
  db: SqliteDatabase,
  id: string,
  status: PageSummary['status'],
  addedAt: string
): void {
  insertPage(db, {
    id,
    projectId: 'proj-1',
    url: `https://example.com/${id}/`,
    title: null,
    label: null,
    folder: null,
    status,
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-1',
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  addPageMarket(db, { pageId: id, marketId: 'mkt-1', addedAt, baselineRunId: null })
}

function job(pageId: string, extra: Partial<PageSetupJob> = {}): PageSetupJob {
  return {
    pageId,
    state: 'running',
    step: 'read',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    nextStep: null,
    startedAt: '2026-10-19T12:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-10-19T12:00:00.000Z',
    ...extra
  }
}
