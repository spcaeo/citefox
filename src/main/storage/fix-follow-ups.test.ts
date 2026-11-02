import { isFixRecheckRule } from '@shared/domain'
import type { BuyerProfile, BuyerPrompt, FixFollowUpInput, PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { contentHash } from '../pipeline/hash'
import { FIX_RECHECK_RULES } from '../scheduler/follow-up'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type NewPromptSet,
  type StoredSnapshot
} from './content-records'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import {
  FIX_FOLLOW_UP_RULES,
  createFixFollowUp,
  deleteFixFollowUpsForPage,
  listFixFollowUps,
  deleteFixFollowUp,
  getFixFollowUp,
  nextFixNumber,
  setFixFollowUpJob,
  setFixFollowUpRun,
  setFixVerdict,
  type NewFixFollowUp
} from './fix-follow-ups'
import { migrate } from './migrate'
import { addPageMarket, insertPage, setPageStatus } from './pages'
import { ensureProjectSchema, insertMarket, writeProjectProfile } from './project-profile'
import { PROJECT_MIGRATIONS } from './project-schema'

const databases: SqliteDatabase[] = []
const NOW = '2026-10-19T12:00:00.000Z'
const BODY = 'TextBolt page body'
const HASH = contentHash(BODY)
const TEMPLATE_HASH = contentHash('template body')

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('fix follow-ups', () => {
  test('stores when a fix was logged, the job Run follow-up now started, and a verdict', () => {
    const db = projectDb()
    seedPage(db, 'page-1', ['prompt-1', 'prompt-2'])
    const created = createFixFollowUp(db, { ...followUp(), createdAt: NOW })
    expect(created.createdAt).toBe(NOW)
    expect(getFixFollowUp(db, 'fix-1')).toEqual(created)
    expect(getFixFollowUp(db, 'fix-missing')).toBeNull()

    const started = setFixFollowUpJob(db, 'fix-1', 'job-7')
    expect(started).toMatchObject({ followUpJobId: 'job-7', status: 'planned' })
    expect(setFixVerdict(db, 'fix-1', 'No change').verdict).toBe('No change')
    expect(setFixVerdict(db, 'fix-1', null).verdict).toBeNull()
    expect(() => setFixVerdict(db, 'fix-1', ' padded ')).toThrow('Invalid fix verdict')
    expect(() => setFixFollowUpJob(db, 'fix-missing', 'job-1')).toThrow('Unknown follow-up')
    expect(() => createFixFollowUp(db, { ...followUp(), id: 'fix-2', createdAt: 'soon' })).toThrow()
  })

  test('deletes one fix and its targeted prompts', () => {
    const db = projectDb()
    seedPage(db, 'page-1', ['prompt-1', 'prompt-2'])
    createFixFollowUp(db, followUp())
    createFixFollowUp(db, { ...followUp(), id: 'fix-2' })
    expect(deleteFixFollowUp(db, 'fix-1')).toBe(true)
    expect(deleteFixFollowUp(db, 'fix-1')).toBe(false)
    expect(listFixFollowUps(db, 'page-1').map((row) => row.id)).toEqual(['fix-2'])
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM fix_prompts WHERE fix_id = 'fix-1'`).get()
    ).toEqual({ n: 0 })
  })

  test('uses the scheduler recheck rules', () => {
    expect([...FIX_FOLLOW_UP_RULES]).toEqual([...FIX_RECHECK_RULES])
    expect(FIX_RECHECK_RULES.every((rule) => isFixRecheckRule(rule))).toBe(true)
    expect(isFixRecheckRule('soon')).toBe(false)
  })

  test('shared follow-up input requires a description and omits the fix number', () => {
    const input: FixFollowUpInput = {
      id: 'fix-1',
      projectId: 'proj-1',
      pageId: 'page-1',
      description: 'Added a Saturday crew FAQ.',
      goLiveAt: '2026-04-10T00:00:00.000Z',
      rule: 'after_3_days',
      promptIds: ['prompt-1'],
      marketIds: ['mkt-us']
    }
    expect(input.description).toBe('Added a Saturday crew FAQ.')
    expect(Object.keys(input)).not.toContain('number')
    expect(Object.keys(input)).not.toContain('fixNumber')
    expect(Object.keys(input)).not.toContain('completed')
  })

  test('creates, lists, and updates status for one page and several markets', () => {
    const db = projectDb()
    seedPage(db, 'page-1', ['prompt-1', 'prompt-2'])
    addPageMarket(db, {
      pageId: 'page-1',
      marketId: 'mkt-mx',
      addedAt: NOW,
      baselineRunId: null
    })

    const created = createFixFollowUp(
      db,
      followUp({
        promptIds: ['prompt-1', 'prompt-2'],
        marketIds: ['mkt-us', 'mkt-mx']
      })
    )
    expect(created).toEqual({
      id: 'fix-1',
      pageId: 'page-1',
      number: 1,
      kind: 'fix',
      description: 'Added a Saturday crew FAQ.',
      goLiveAt: '2026-04-10T00:00:00.000Z',
      rule: 'after_3_days',
      promptIds: ['prompt-1', 'prompt-2'],
      marketIds: ['mkt-us', 'mkt-mx'],
      followUpRunId: null,
      followUpJobId: null,
      verdict: null,
      status: 'planned',
      createdAt: null,
      url: null,
      pageFixId: null,
      workedNotedAt: null
    })

    const second = createFixFollowUp(db, {
      ...followUp(),
      id: 'fix-2',
      description: 'Tightened the pricing section.',
      rule: 'next_scheduled',
      promptIds: ['prompt-2'],
      marketIds: ['mkt-us'],
      number: 4
    })
    expect(second.number).toBe(4)
    expect(listFixFollowUps(db).map((row) => row.id)).toEqual(['fix-1', 'fix-2'])
    expect(listFixFollowUps(db, 'page-1').map((row) => row.number)).toEqual([1, 4])

    expect(created.status).toBe('planned')
    expect(created.followUpRunId).toBeNull()

    const done = setFixFollowUpRun(db, 'fix-1', 'run-9', 'Partly worked · 1 of 2 prompts')
    expect(done).toMatchObject({
      status: 'completed',
      followUpRunId: 'run-9',
      verdict: 'Partly worked · 1 of 2 prompts'
    })
    expect(setFixFollowUpRun(db, 'fix-1', 'run-9').verdict).toBe('Partly worked · 1 of 2 prompts')
    expect(setFixFollowUpRun(db, 'fix-1', 'run-10', null)).toMatchObject({
      status: 'completed',
      followUpRunId: 'run-10',
      verdict: null
    })
    expect(listFixFollowUps(db, 'page-1').find((row) => row.id === 'fix-1')?.status).toBe(
      'completed'
    )
    expect(listFixFollowUps(db, 'page-1').find((row) => row.id === 'fix-2')?.status).toBe('planned')
  })

  test('reads the next fix number per page for results:get', () => {
    const db = projectDb()
    seedPage(db, 'page-1', ['prompt-1'])
    expect(nextFixNumber(db, 'page-1')).toBe(1)
    createFixFollowUp(db, followUp({ id: 'fix-1', number: 3 }))
    expect(nextFixNumber(db, 'page-1')).toBe(4)
  })

  test('assigns the next fix number and rejects duplicates, secrets, and unknown targets', () => {
    const db = projectDb()
    seedPage(db, 'page-1', ['prompt-1'])
    seedPage(db, 'page-2', ['prompt-9'])
    expect(createFixFollowUp(db, followUp({ id: 'fix-1', number: undefined })).number).toBe(1)
    expect(createFixFollowUp(db, followUp({ id: 'fix-2', promptIds: ['prompt-1'] })).number).toBe(2)
    expect(() => createFixFollowUp(db, followUp({ id: 'fix-3', number: 2 }))).toThrow(
      /Fix number already used/
    )
    expect(() => createFixFollowUp(db, followUp({ id: 'fix-1' }))).toThrow(/already exists/)
    expect(() =>
      createFixFollowUp(db, followUp({ id: 'fix-4', rule: 'in_three_days' as 'after_3_days' }))
    ).toThrow(/follow-up rule/)
    expect(() => createFixFollowUp(db, followUp({ id: 'fix-4', promptIds: [] }))).toThrow(
      /at least one prompt/
    )
    expect(() => createFixFollowUp(db, followUp({ id: 'fix-4', marketIds: [] }))).toThrow(
      /at least one market/
    )
    expect(() =>
      createFixFollowUp(db, followUp({ id: 'fix-4', marketIds: ['mkt-us', 'mkt-us'] }))
    ).toThrow(/Duplicate follow-up market/)
    expect(() =>
      createFixFollowUp(db, followUp({ id: 'fix-4', promptIds: ['prompt-gone'] }))
    ).toThrow(/Unknown prompt/)
    expect(() => createFixFollowUp(db, followUp({ id: 'fix-4', marketIds: ['mkt-mx'] }))).toThrow(
      /Unknown page market/
    )
    expect(() =>
      createFixFollowUp(db, followUp({ id: 'fix-4', description: 'see sk-ant-abcdefghij1234' }))
    ).toThrow(/secret/)
    expect(() => createFixFollowUp(db, followUp({ id: 'fix-4', pageId: 'page-missing' }))).toThrow(
      /Unknown page/
    )
    expect(() => setFixFollowUpRun(db, 'fix-missing', 'run-1')).toThrow(/Unknown follow-up/)
    expect(listFixFollowUps(db).map((row) => row.id)).toEqual(['fix-1', 'fix-2'])
  })

  test('deletes follow-ups when the page is removed and leaves the other page', () => {
    const db = projectDb()
    seedPage(db, 'page-1', ['prompt-1'])
    seedPage(db, 'page-2', ['prompt-9'])
    createFixFollowUp(db, followUp({ id: 'fix-1' }))
    createFixFollowUp(
      db,
      followUp({
        id: 'fix-9',
        pageId: 'page-2',
        promptIds: ['prompt-9'],
        description: 'Rewrote the pricing answer.'
      })
    )
    expect(deleteFixFollowUpsForPage(db, 'page-absent')).toBe(0)
    setPageStatus(db, 'page-1', 'paused', 'proj-1')
    expect(listFixFollowUps(db, 'page-1')).toHaveLength(1)
    expect(deleteFixFollowUpsForPage(db, 'page-1')).toBe(1)
    createFixFollowUp(db, followUp({ id: 'fix-3', promptIds: ['prompt-1'] }))
    setPageStatus(db, 'page-1', 'removed', 'proj-1')
    expect(listFixFollowUps(db, 'page-1')).toEqual([])
    expect(listFixFollowUps(db).map((row) => row.id)).toEqual(['fix-9'])
    expect(() => createFixFollowUp(db, followUp({ id: 'fix-4' }))).toThrow(/removed page/)
    const prompts = db
      .prepare<unknown[], { id: string }>(`SELECT id FROM prompts WHERE id = 'prompt-1'`)
      .get()
    expect(prompts?.id).toBe('prompt-1')
  })

  test('upgrades an existing project file with empty fix tables', () => {
    const db = openSqliteDatabase(':memory:')
    databases.push(db)
    migrate(db, PROJECT_MIGRATIONS.slice(0, 9))
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(listFixFollowUps(db)).toEqual([])
    expect(listFixFollowUps(db, 'page-1')).toEqual([])
    const page = db.prepare<unknown[], { id: string }>(`SELECT id FROM pages`).get()
    expect(page?.id).toBe('page-1')
    const columns = db
      .prepare<unknown[], { name: string }>('PRAGMA table_info(fixes)')
      .all()
      .map((column) => column.name)
    expect(columns).not.toContain('status')
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'page_id',
        'number',
        'description',
        'live_on',
        'recheck_rule',
        'markets',
        'followup_run_id',
        'verdict'
      ])
    )
    expect(() =>
      db
        .prepare(
          `INSERT INTO fixes (
             id, page_id, number, description, live_on, recheck_rule, markets
           ) VALUES ('fix-x', 'page-1', 1, 'Change', '2026-04-10T00:00:00.000Z', 'soon', '["mkt-us"]')`
        )
        .run()
    ).toThrow()
    db.prepare(
      `INSERT INTO fixes (
         id, page_id, number, description, live_on, recheck_rule, markets
       ) VALUES ('fix-x', 'page-1', 1, 'Change', '2026-04-10T00:00:00.000Z', 'after_7_days', '["mkt-us"]')`
    ).run()
    expect(listFixFollowUps(db, 'page-1')[0]).toMatchObject({
      id: 'fix-x',
      status: 'planned',
      followUpRunId: null,
      verdict: null
    })
    expect(() =>
      db.prepare(`INSERT INTO fix_prompts (fix_id, prompt_id) VALUES ('fix-x', 'missing')`).run()
    ).toThrow()
    const names = db
      .prepare<unknown[], { name: string }>('SELECT name FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.name)
    expect(names).toContain('010_fix_follow_ups')
  })
})

function followUp(overrides: Partial<NewFixFollowUp> = {}): NewFixFollowUp {
  return {
    id: 'fix-1',
    pageId: 'page-1',
    description: 'Added a Saturday crew FAQ.',
    goLiveAt: '2026-04-10T00:00:00.000Z',
    rule: 'after_3_days',
    promptIds: ['prompt-1'],
    marketIds: ['mkt-us'],
    ...overrides
  }
}

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  writeProjectProfile(db, {
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
  insertMarket(db, {
    id: 'mkt-mx',
    country: 'MX',
    language: 'es',
    location: 'Mexico City',
    device: 'desktop',
    localWording: true,
    serpapiLocation: null
  })
  return db
}

function seedPage(db: SqliteDatabase, pageId: string, promptIds: readonly string[]): void {
  insertPage(db, page(pageId))
  addPageMarket(db, {
    pageId,
    marketId: 'mkt-us',
    addedAt: NOW,
    baselineRunId: null
  })
  const snapshotId = `snap-${pageId}`
  const profileId = `icp-${pageId}`
  insertSnapshot(db, snapshot(pageId, snapshotId))
  insertBuyerProfile(db, profile(pageId, snapshotId, profileId))
  insertPromptSet(db, promptSet(pageId, profileId, promptIds), ['TextBolt'])
}

function page(pageId: string): PageSummary {
  return {
    id: pageId,
    projectId: 'proj-1',
    url: `https://textbolt.com/${pageId}`,
    title: null,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function snapshot(pageId: string, id: string): StoredSnapshot {
  return {
    id,
    pageId,
    fetchedAt: NOW,
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
  }
}

function profile(pageId: string, snapshotId: string, id: string): BuyerProfile {
  return {
    id,
    pageId,
    snapshotId,
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
    createdAt: NOW,
    promptsStale: false
  }
}

function promptSet(pageId: string, icpId: string, promptIds: readonly string[]): NewPromptSet {
  return {
    id: `pset-${pageId}`,
    pageId,
    version: 1,
    savedAt: NOW,
    icpId,
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: TEMPLATE_HASH,
    templateUpdatedAt: null,
    prompts: promptIds.map((id, index) => buyerPrompt(id, index + 1))
  }
}

function buyerPrompt(id: string, position: number): BuyerPrompt {
  return {
    id,
    position,
    label: `Prompt ${position}`,
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      {
        marketId: 'mkt-us',
        language: 'en',
        text: `How do I handle case ${position} on a Saturday morning?`,
        originalText: null
      }
    ]
  }
}
