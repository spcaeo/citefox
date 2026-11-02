import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerPrompt, PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { contentHash } from '../pipeline/hash'
import { openAppStorage } from '../storage/app-storage'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../storage/check-records'
import { insertBuyerProfile, insertPromptSet, insertSnapshot } from '../storage/content-records'
import { addPageMarket, insertPage } from '../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { createStorageExportSource } from './source'
import type { ExportDataSource } from './types'

const closers: Array<() => void> = []
const directories: string[] = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('storage export source', () => {
  test('own subdomains join the you row when the project counts subdomains', async () => {
    const source = seed({ includeSubdomains: true })
    const rows = await leaderboard(source)
    expect(rows.map((row) => [row.domain, row.badge])).toEqual([
      ['textbolt.com', 'you'],
      ['twilio.com', 'tracked']
    ])
    expect(rows[0]?.averagePosition).toBe(1)
  })

  test('own subdomains stay their own row when the project does not count them', async () => {
    const source = seed({ includeSubdomains: false })
    const rows = await leaderboard(source)
    expect(rows.map((row) => [row.domain, row.badge])).toEqual([
      ['textbolt.com', 'you'],
      ['twilio.com', 'tracked'],
      ['help.textbolt.com', 'observed']
    ])
  })
})

async function leaderboard(
  source: ExportDataSource
): Promise<
  Awaited<
    ReturnType<ExportDataSource['loadExportDataset']>
  >['pages'][number]['markets'][number]['checks'][number]['leaderboard']
> {
  const dataset = await source.loadExportDataset({
    projectId: 'proj-1',
    scope: 'page',
    pageIds: ['page-1'],
    viewId: null,
    marketIds: ['mkt-us'],
    checks: 'latest',
    from: null,
    to: null,
    timeZone: 'UTC'
  })
  const check = dataset.pages[0]?.markets[0]?.checks[0]
  expect(check).toBeDefined()
  return check?.leaderboard ?? []
}

function seed(options: { includeSubdomains: boolean }): ExportDataSource {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-export-source-'))
  directories.push(directory)
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  writeProjectProfile(db, {
    includeSubdomains: options.includeSubdomains,
    brandNames: ['TextBolt'],
    competitors: ['twilio.com'],
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
  insertPage(db, page())
  addPageMarket(db, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: '2026-10-01T12:00:00.000Z',
    baselineRunId: null
  })
  const hash = contentHash('TextBolt page body')
  insertSnapshot(db, {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: '2026-10-01T12:00:00.000Z',
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Alerts',
    metaDescription: 'Alert the crew.',
    h1: 'Alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: 'TextBolt page body',
    wordCount: 3,
    contentHash: hash,
    summary: null
  })
  insertBuyerProfile(db, {
    id: 'icp-1',
    pageId: 'page-1',
    snapshotId: 'snap-1',
    who: 'Office managers.',
    environment: 'They send email.',
    segments: [],
    triggers: [],
    values: [],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    promptsStale: false
  })
  insertPromptSet(db, promptSet(), ['TextBolt'])
  insertStoredCheckJob(db, {
    id: 'job-1',
    startedAt: '2026-10-19T15:00:00.000Z',
    status: 'running',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: ['prompt-1'],
    reason: 'manual',
    message: null,
    nextStep: null
  })
  insertStoredRun(db, {
    id: 'run-1',
    jobId: 'job-1',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt: '2026-10-19T15:00:00.000Z',
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: hash
  })
  finishStoredRun(db, 'run-1', '2026-10-19T16:00:00.000Z', 'finished')
  insertStoredSerpResult(db, {
    id: 'serp-1',
    runId: 'run-1',
    promptId: 'prompt-1',
    sampleNo: 1,
    keyId: null,
    hasAio: true,
    neededFollowup: false,
    searches: 1,
    status: 'page_cited',
    named: true,
    citedUrl: 'https://textbolt.com/alerts',
    position: 1,
    aioText: 'Stored overview quote.',
    errorCode: null,
    message: null,
    nextStep: null,
    rawSearchJson: null,
    rawAioJson: null,
    references: [
      reference('ref-1', 1, 'https://textbolt.com/alerts', 'textbolt.com', 'target'),
      reference('ref-2', 2, 'https://help.textbolt.com/alerts', 'help.textbolt.com', 'other'),
      reference('ref-3', 3, 'https://twilio.com/sms', 'twilio.com', 'competitor')
    ]
  })
  closeProjectDatabase(db)
  return createStorageExportSource({
    app: storage.db,
    projectsDirectory: storage.paths.projectsDirectory,
    now: () => new Date('2026-10-20T12:00:00.000Z')
  })
}

function reference(
  id: string,
  position: number,
  url: string,
  domain: string,
  classification: 'target' | 'own' | 'competitor' | 'other'
): Parameters<typeof insertStoredSerpResult>[1]['references'][number] {
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain,
    title: null,
    classification,
    untracked: false,
    sourceType: 'web'
  }
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/alerts',
    title: 'Alerts',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 1,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function promptSet(): Parameters<typeof insertPromptSet>[1] {
  const prompt: BuyerPrompt = {
    id: 'prompt-1',
    position: 1,
    label: 'Crew',
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      { marketId: 'mkt-us', language: 'en', text: 'How do I alert the crew?', originalText: null }
    ]
  }
  return {
    id: 'pset-1',
    pageId: 'page-1',
    version: 1,
    savedAt: '2026-10-01T12:00:00.000Z',
    icpId: 'icp-1',
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    prompts: [prompt]
  }
}
