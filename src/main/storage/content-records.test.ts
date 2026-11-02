import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { contentHash } from '../pipeline/hash'
import {
  activatePromptSet,
  getCachedGeneration,
  getLatestBuyerProfile,
  getLatestCoverage,
  getLatestPromptSet,
  getLatestSnapshot,
  getPromptSetVersion,
  insertBuyerProfile,
  insertCoverage,
  insertGeneration,
  insertPromptSet,
  insertSnapshot,
  listGenerations,
  listSavedPromptSets,
  nextPromptSetVersion,
  setSnapshotEligibility,
  type GenerationRecord,
  type NewPromptSet,
  type StoredSnapshot
} from './content-records'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { insertPage } from './pages'
import { ensureProjectSchema, insertMarket, writeProjectProfile } from './project-profile'

const databases: SqliteDatabase[] = []
const NOW = '2026-10-19T12:00:00.000Z'
const BODY = 'TextBolt page body'
const HASH = contentHash(BODY)
const OTHER_HASH = contentHash('a later page body')
const TEMPLATE_HASH = contentHash('template body')

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('content records', () => {
  test('stores a snapshot and reads the latest one back', () => {
    const db = projectDb()
    insertSnapshot(db, snapshot({ id: 'snap-1', fetchedAt: NOW }))
    insertSnapshot(db, snapshot({ id: 'snap-2', fetchedAt: '2026-10-19T13:00:00.000Z' }))
    expect(getLatestSnapshot(db, 'page-1')?.id).toBe('snap-2')
    expect(getLatestSnapshot(db, 'page-1')).toMatchObject({
      method: 'jina',
      contentHash: HASH,
      publishedAt: '2026-07-28T11:22:29.000Z',
      modifiedAt: null,
      outline: [{ level: 'h2', text: 'Pricing', table: false }],
      faqs: [
        {
          question: 'Why the extra mark??',
          answer: 'Because the question was typed twice.',
          typo: null
        }
      ]
    })
  })

  test("keeps a snapshot's eligibility, updates it, and reads an old row as unknown", () => {
    const db = projectDb()
    insertSnapshot(db, snapshot({ id: 'snap-old' }))
    expect(getLatestSnapshot(db, 'page-1')?.eligibility).toBeNull()
    insertSnapshot(db, {
      ...snapshot({ id: 'snap-1', fetchedAt: '2026-10-19T13:00:00.000Z' }),
      eligibility: { issues: [{ code: 'nosnippet', where: 'header', detail: 'nosnippet' }] }
    })
    expect(getLatestSnapshot(db, 'page-1')?.eligibility).toEqual({
      issues: [{ code: 'nosnippet', where: 'header', detail: 'nosnippet' }]
    })
    setSnapshotEligibility(db, 'snap-1', { issues: [] })
    expect(getLatestSnapshot(db, 'page-1')?.eligibility).toEqual({ issues: [] })
    expect(() => setSnapshotEligibility(db, 'snap-missing', { issues: [] })).toThrow()
    // An entry this app does not know is dropped on read, so an odd row never breaks a read.
    db.prepare('UPDATE snapshots SET eligibility_json = ? WHERE id = ?').run(
      JSON.stringify({ issues: [{ code: 'other', where: 'meta', detail: 'x' }] }),
      'snap-1'
    )
    expect(getLatestSnapshot(db, 'page-1')?.eligibility).toEqual({ issues: [] })
  })

  test('uses the latest buyer profile and marks prompts stale when they point at an older one', () => {
    const db = projectDb()
    insertSnapshot(db, snapshot({ id: 'snap-1' }))
    insertBuyerProfile(db, profile({ id: 'icp-1', createdAt: NOW }))
    insertPromptSet(
      db,
      {
        id: 'pset-1',
        pageId: 'page-1',
        version: 1,
        savedAt: NOW,
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: TEMPLATE_HASH,
        templateUpdatedAt: null,
        prompts: [buyerPrompt('prompt-1', 'How do I alert the crew this Saturday morning?')]
      },
      ['TextBolt', 'Text Bolt']
    )
    expect(getLatestBuyerProfile(db, 'page-1')).toMatchObject({ id: 'icp-1', promptsStale: false })
    insertBuyerProfile(db, profile({ id: 'icp-2', createdAt: '2026-10-19T13:00:00.000Z' }))
    expect(getLatestBuyerProfile(db, 'page-1')).toMatchObject({ id: 'icp-2', promptsStale: true })
  })

  test('reads a buyer profile whose who, environment or reasons are empty', () => {
    const db = projectDb()
    insertSnapshot(db, snapshot({ id: 'snap-1' }))
    insertBuyerProfile(db, {
      ...profile({ id: 'icp-1' }),
      who: '',
      environment: '',
      segments: [{ name: 'Field teams', reason: '' }]
    })
    expect(getLatestBuyerProfile(db, 'page-1')).toMatchObject({
      id: 'icp-1',
      who: '',
      environment: '',
      segments: [{ name: 'Field teams', reason: '' }]
    })
  })

  test('keeps an older prompt-set version when a new one is saved', () => {
    const db = projectDb()
    insertSnapshot(db, snapshot({ id: 'snap-1' }))
    insertBuyerProfile(db, profile({ id: 'icp-1' }))
    insertPromptSet(db, promptSet('pset-1', 1, 'How do I alert the crew this Saturday morning?'), [
      'TextBolt'
    ])
    insertPromptSet(
      db,
      promptSet('pset-2', 2, 'How do I alert the Saturday crew before sunrise?'),
      ['TextBolt']
    )
    expect(nextPromptSetVersion(db, 'page-1')).toBe(3)
    expect(getPromptSetVersion(db, 'page-1', 1, ['TextBolt'])?.prompts[0]?.variants[0]?.text).toBe(
      'How do I alert the crew this Saturday morning?'
    )
    expect(getPromptSetVersion(db, 'page-1', 2, ['TextBolt'])?.version).toBe(2)
    expect(getPromptSetVersion(db, 'page-1', 2, ['TextBolt'])?.templateUpdatedAt).toBeNull()
    expect(getLatestPromptSet(db, 'page-1', ['TextBolt'])?.promptSetId).toBe('pset-2')
  })

  test('keeps exactly one active prompt set and switches it without a new version', () => {
    const db = projectDb()
    insertSnapshot(db, snapshot({ id: 'snap-1' }))
    insertBuyerProfile(db, profile({ id: 'icp-1' }))
    const older = promptSet('pset-1', 1, 'How do I alert the crew this Saturday morning?')
    older.savedAt = '2026-10-19T12:00:00.000Z'
    older.templateId = null
    older.templateName = null
    older.templateHash = null
    const newer = promptSet('pset-2', 2, 'How do I alert the Saturday crew before sunrise?')
    newer.savedAt = '2026-10-19T13:00:00.000Z'
    newer.prompts = [
      buyerPrompt('prompt-2', 'How do I alert the Saturday crew before sunrise?'),
      {
        ...buyerPrompt('prompt-3', 'How do I hear about a change?'),
        position: 2,
        enabled: false
      }
    ]
    insertPromptSet(db, older, ['TextBolt'])
    insertPromptSet(db, newer, ['TextBolt'])
    expect(listSavedPromptSets(db, 'page-1')).toEqual([
      {
        id: 'pset-2',
        createdAt: '2026-10-19T13:00:00.000Z',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        promptCount: 2,
        isActive: true
      },
      {
        id: 'pset-1',
        createdAt: '2026-10-19T12:00:00.000Z',
        templateId: null,
        templateName: null,
        promptCount: 1,
        isActive: false
      }
    ])
    const switched = activatePromptSet(db, 'page-1', 'pset-1', ['TextBolt'])
    expect(switched).toMatchObject({ promptSetId: 'pset-1', version: 1, dirty: false })
    expect(nextPromptSetVersion(db, 'page-1')).toBe(3)
    expect(getLatestPromptSet(db, 'page-1', ['TextBolt'])?.promptSetId).toBe('pset-1')
    expect(
      listSavedPromptSets(db, 'page-1')
        .filter((set) => set.isActive)
        .map((set) => set.id)
    ).toEqual(['pset-1'])
    expect(activatePromptSet(db, 'page-1', 'missing', ['TextBolt'])).toBeNull()
  })

  test('marks coverage stale when the content hash changes and caches generation usage', () => {
    const db = projectDb()
    insertSnapshot(db, snapshot({ id: 'snap-1' }))
    insertBuyerProfile(db, profile({ id: 'icp-1' }))
    insertPromptSet(db, promptSet('pset-1', 1, 'How do I alert the crew this Saturday morning?'), [
      'TextBolt'
    ])
    insertCoverage(db, {
      runId: 'run-1',
      pageId: 'page-1',
      recordedAt: NOW,
      templateId: 'tpl-coverage',
      templateName: 'CiteFox default',
      templateHash: TEMPLATE_HASH,
      templateUpdatedAt: null,
      contentHash: HASH,
      reused: false,
      stale: false,
      rows: [
        {
          id: 'cov-1',
          runId: 'run-1',
          pageId: 'page-1',
          promptId: 'prompt-1',
          coverage: 'partial',
          whereCovered: ['Pricing'],
          currentContent: 'Pricing is on the page.',
          whatToUpdate: 'Add a clearer price line.',
          mainGap: 'Price is easy to miss.',
          priority: 'medium',
          actions: ['update_existing'],
          suggestedFaq: null,
          done: false
        }
      ],
      findings: []
    })
    expect(getLatestCoverage(db, 'page-1', HASH)).toMatchObject({
      contentHash: HASH,
      reused: false,
      stale: false
    })
    expect(getLatestCoverage(db, 'page-1', OTHER_HASH)?.stale).toBe(true)

    const usage = {
      inputTokens: 101,
      outputTokens: 55,
      cacheReadTokens: 7,
      cacheCreationTokens: 3,
      serpapiSearches: 0
    }
    const record: GenerationRecord = {
      id: 'gen-1',
      pageId: 'page-1',
      kind: 'buyer_profile',
      templateId: 'tpl-buyer-profile',
      templateHash: TEMPLATE_HASH,
      startedAt: NOW,
      durationMs: 12,
      model: 'claude-sonnet',
      connection: 'claude-code',
      ok: true,
      error: null,
      inputHash: HASH,
      usage
    }
    insertGeneration(db, record, { who: 'operators' })
    expect(getCachedGeneration(db, 'buyer_profile', HASH)).toMatchObject({
      output: { who: 'operators' },
      usage
    })
    expect(listGenerations(db, 'page-1')[0]?.usage).toEqual(usage)
    expect(listGenerations(db, 'page-1')[0]?.usage.serpapiSearches).toBe(0)
  })
})

function projectDb(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['Twilio'],
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
  insertPage(db, page())
  return db
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    title: null,
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function snapshot(overrides: Partial<StoredSnapshot>): StoredSnapshot {
  return {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: NOW,
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Alerts',
    metaDescription: 'How alerts work.',
    h1: 'Alerts',
    canonical: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    publishedAt: '2026-07-28T11:22:29.000Z',
    modifiedAt: null,
    outline: [{ level: 'h2', text: 'Pricing', table: false }],
    faqs: [
      {
        question: 'Why the extra mark??',
        answer: 'Because the question was typed twice.',
        typo: null
      }
    ],
    h2Count: 1,
    h3Count: 0,
    tableCount: 0,
    bodyText: BODY,
    wordCount: 3,
    contentHash: HASH,
    summary: null,
    ...overrides
  }
}

function profile(overrides: { id: string; createdAt?: string }): BuyerProfile {
  return {
    id: overrides.id,
    pageId: 'page-1',
    snapshotId: 'snap-1',
    who: 'Office managers at small US firms.',
    environment: 'They already send email from scheduling tools.',
    segments: [{ name: 'Field teams', reason: 'They are away from the desk.' }],
    triggers: ['A missed weekend alert caused damage.'],
    values: ['Predictable pricing at $29 a month'],
    poorFit: [{ name: 'SMS marketers', reason: 'This page is not about campaigns.' }],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: TEMPLATE_HASH,
    templateUpdatedAt: null,
    createdAt: overrides.createdAt ?? NOW,
    promptsStale: false
  }
}

function promptSet(id: string, version: number, text: string): NewPromptSet {
  return {
    id,
    pageId: 'page-1',
    version,
    savedAt: NOW,
    icpId: 'icp-1',
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: TEMPLATE_HASH,
    templateUpdatedAt: null,
    prompts: [buyerPrompt(version === 1 ? 'prompt-1' : 'prompt-2', text)]
  }
}

function buyerPrompt(id: string, text: string): BuyerPrompt {
  return {
    id,
    position: 1,
    label: 'Saturday crew',
    source: 'title_meta_h1' as const,
    intentStage: 'problem' as const,
    mappedElement: 'intro',
    enabled: true,
    variants: [
      {
        marketId: 'mkt-us',
        language: 'en',
        text,
        originalText: null
      }
    ]
  }
}

function track(db: SqliteDatabase): SqliteDatabase {
  databases.push(db)
  return db
}
