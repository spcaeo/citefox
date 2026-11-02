import type { ElectronApplication } from '@playwright/test'
import type { BuyerProfile, BuyerPrompt, Market, PageSummary } from '@shared/domain'
import type { CheckJob, CheckStepSnapshot } from '@shared/ipc'
import { contentHash } from '../../src/main/pipeline/hash'
import { openAppStorage } from '../../src/main/storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot
} from '../../src/main/storage/content-records'
import { addPageMarket, insertPage } from '../../src/main/storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../src/main/storage/project-files'
import { insertMarket, writeProjectProfile } from '../../src/main/storage/project-profile'
import {
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../../src/main/storage/records'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'

const AT = '2026-10-19T12:00:00.000Z'

/**
 * The owner's Checking screen: one page in four markets with ten long buyer
 * prompts, part-way through the first market.
 */
export const RUNNING_SEED = {
  projectId: 'proj-run',
  pageId: 'page-run',
  markets: ['mkt-us', 'mkt-uk', 'mkt-ca', 'mkt-au'],
  prompts: [
    'What is the easiest way to send automated text alerts to a field crew when the job schedule changes at short notice?',
    'Which business texting tools let an office manager schedule recurring SMS reminders without writing any code?',
    'How can a small construction company text every worker on site at once when the weather closes the job?',
    'Is there a texting service that turns emails from our booking system into text messages for customers automatically?',
    'What does it cost per month to send around two thousand appointment reminder texts for a dental practice?',
    'How do I stop customers replying STOP from getting more texts while keeping my opt-in list compliant?',
    'Which SMS platforms work with Gmail and Outlook so staff can send texts straight from their inbox?',
    'Can I send a text alert to a group of volunteers from a spreadsheet without paying for a developer?',
    'What is the best alternative to Twilio for a non-technical team that only needs to send bulk text messages?',
    'How fast are emergency text alerts delivered to staff phones compared with email and push notifications?'
  ]
} as const

const COUNTRIES = ['US', 'UK', 'CA', 'AU'] as const

function market(index: number): Market {
  return {
    id: RUNNING_SEED.markets[index] ?? 'mkt-us',
    country: COUNTRIES[index] ?? 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  }
}

/** Seeds the four-market, ten-prompt page. No check has run, so the screen waits on the job. */
export function seedRunningProject(userDataDir: string): void {
  const storage = openAppStorage(userDataDir)
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'fieldtext')
  try {
    insertProject(storage.db, {
      id: RUNNING_SEED.projectId,
      name: 'FieldText',
      slug: 'fieldtext',
      domain: 'fieldtext.example',
      dbPath: projectDatabaseRelativePath('fieldtext'),
      clientName: null,
      status: 'active'
    })
    writeProjectProfile(db, {
      includeSubdomains: false,
      brandNames: ['FieldText'],
      competitors: ['twilio.com'],
      market: market(0)
    })
    for (let index = 1; index < COUNTRIES.length; index += 1) insertMarket(db, market(index))
    insertPage(db, page())
    for (const marketId of RUNNING_SEED.markets) {
      addPageMarket(db, { pageId: RUNNING_SEED.pageId, marketId, addedAt: AT, baselineRunId: null })
    }
    const body = 'FieldText sends text alerts to field crews from email and spreadsheets.'
    insertSnapshot(db, {
      id: 'snap-run',
      pageId: RUNNING_SEED.pageId,
      fetchedAt: AT,
      method: 'jina',
      httpStatus: 200,
      durationMs: 4,
      title: 'Text alerts for field crews',
      metaDescription: null,
      h1: 'Text alerts for field crews',
      canonical: null,
      publishedAt: null,
      modifiedAt: null,
      outline: [],
      faqs: [],
      h2Count: 0,
      h3Count: 0,
      tableCount: 0,
      bodyText: body,
      wordCount: 11,
      contentHash: contentHash(body),
      summary: null
    })
    insertBuyerProfile(db, profile())
    insertPromptSet(
      db,
      {
        id: 'pset-run',
        pageId: RUNNING_SEED.pageId,
        version: 1,
        savedAt: AT,
        icpId: 'icp-run',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: RUNNING_SEED.prompts.map((text, index) => prompt(index, text))
      },
      ['FieldText']
    )
    writeOnboardingFinished(storage.db, true)
    writeActiveProjectId(storage.db, RUNNING_SEED.projectId)
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}

/** First market part-way: prompts 1-3 done, prompt 4 on the AI Overview step, the rest queued. */
export function runningJob(): CheckJob {
  const steps: CheckStepSnapshot[] = []
  const [first] = RUNNING_SEED.markets
  RUNNING_SEED.prompts.slice(0, 4).forEach((text, index) => {
    const done = index < 3
    const base = {
      pageId: RUNNING_SEED.pageId,
      marketId: first,
      promptId: `prompt-${index + 1}`,
      promptPosition: index + 1,
      label: `Prompt ${index + 1}`,
      promptText: text,
      detail: '',
      errorCode: null,
      error: null,
      retrySearches: 0
    } as const
    steps.push({ ...base, sampleNo: 1, phase: 'search', state: 'ok' })
    steps.push({
      ...base,
      sampleNo: 1,
      phase: 'aio',
      state: done ? 'ok' : 'running',
      detail: done ? 'AI Overview found' : ''
    })
    steps.push({ ...base, sampleNo: null, phase: 'analysis', state: done ? 'ok' : 'waiting' })
  })
  const total = RUNNING_SEED.prompts.length
  return {
    id: 'job-run',
    projectId: RUNNING_SEED.projectId,
    pageIds: [RUNNING_SEED.pageId],
    marketIds: [...RUNNING_SEED.markets],
    promptIds: null,
    status: 'running',
    startedAt: AT,
    finishedAt: null,
    done: 3,
    total: total * RUNNING_SEED.markets.length,
    searchesUsed: 7,
    searchesMax: total * RUNNING_SEED.markets.length * 2,
    brandSearchesMax: 0,
    monthUsed: 40,
    monthLimit: null,
    runIds: ['run-us'],
    markets: RUNNING_SEED.markets.map((marketId, index) => ({
      marketId,
      done: index === 0 ? 3 : 0,
      total,
      state: index === 0 ? 'running' : 'waiting'
    })),
    steps,
    message: null,
    nextStep: null
  }
}

/** Answers `checks:listActive` and `checks:get` in the main process with `job`. */
export async function stubRunningJob(app: ElectronApplication, job: CheckJob): Promise<void> {
  await app.evaluate(({ ipcMain }, value) => {
    ipcMain.removeHandler('checks:listActive')
    ipcMain.handle('checks:listActive', () => [value])
    ipcMain.removeHandler('checks:get')
    ipcMain.handle('checks:get', () => value)
  }, job)
}

function page(): PageSummary {
  return {
    id: RUNNING_SEED.pageId,
    projectId: RUNNING_SEED.projectId,
    url: 'https://fieldtext.example/blog/text-alerts-for-field-crews/',
    title: 'Text alerts for field crews',
    label: 'Crew alerts',
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: RUNNING_SEED.prompts.length,
    defaultMarketId: RUNNING_SEED.markets[0],
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function profile(): BuyerProfile {
  return {
    id: 'icp-run',
    pageId: RUNNING_SEED.pageId,
    snapshotId: 'snap-run',
    who: 'Operations managers at field-service companies.',
    environment: 'They schedule crews from email and spreadsheets.',
    segments: [],
    triggers: [],
    values: [],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: AT,
    promptsStale: false
  }
}

function prompt(index: number, text: string): BuyerPrompt {
  return {
    id: `prompt-${index + 1}`,
    position: index + 1,
    label: `Prompt ${index + 1}`,
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [{ marketId: RUNNING_SEED.markets[0], language: 'en', text, originalText: null }]
  }
}
