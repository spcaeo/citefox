import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary, PromptCheckStatus } from '@shared/domain'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createLogger } from '../../logging/logger'
import { contentHash, wordCount } from '../../pipeline/hash'
import type { GenerationCallCaps } from '../../pipeline/llm'
import type { ClaudeCompletion, ClaudeProvider } from '../../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../../providers/claude/parse'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  type NewAioReference
} from '../../storage/check-records'
import { listAnalysesByMarket, listAnalysesByRun } from '../../storage/analyses'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  listGenerations,
  type NewPromptSet,
  type StoredSnapshot
} from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { addPageMarket, insertPage } from '../../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../storage/project-files'
import { insertMarket, writeProjectProfile } from '../../storage/project-profile'
import { aioGapPath, runSummaryPath } from './report-files'
import { AIO_GAP_TEMPLATE, RUN_SUMMARY_TEMPLATE } from './report-templates'
import { writeCheckReports } from './reports'

const NOW = '2026-10-19T12:00:00.000Z'
const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const BODY = 'TextBolt turns email into SMS. It does not say that carrier gateways shut down.'
const PLANTED = 'sk-ant-api03-abcdefghij'
const PLANTED_EXACT = 'citefox-planted-secret'
const USAGE = {
  inputTokens: 11,
  outputTokens: 7,
  cacheReadTokens: 2,
  cacheCreationTokens: 1,
  serpapiSearches: 0
}
const MARKETS = [
  { id: 'mkt-us', country: 'US', language: 'en' },
  { id: 'mkt-gap', country: 'US', language: 'en' },
  { id: 'mkt-cap', country: 'CA', language: 'en' },
  { id: 'mkt-secret', country: 'GB', language: 'en' },
  { id: 'mkt-cancelled', country: 'US', language: 'en' },
  { id: 'mkt-error', country: 'US', language: 'en' }
] as const

let db: SqliteDatabase
let reportsRoot: string
let directory: string

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'citefox-analyses-'))
  reportsRoot = join(directory, 'check-reports')
  db = createProjectDatabase(directory, 'textbolt')
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['SimpleTexting'],
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
  for (const market of MARKETS) {
    if (market.id === 'mkt-us') continue
    insertMarket(db, {
      id: market.id,
      country: market.country,
      language: market.language,
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    })
  }
  insertPage(db, page())
  for (const market of MARKETS) {
    addPageMarket(db, {
      pageId: 'page-1',
      marketId: market.id,
      addedAt: NOW,
      baselineRunId: null
    })
  }
  insertSnapshot(db, snapshot())
  insertBuyerProfile(db, buyer())
  insertPromptSet(db, promptSet(), ['TextBolt'])
  insertStoredCheckJob(db, {
    id: 'job-1',
    startedAt: NOW,
    status: 'running',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  storeRun('run-gap', 'mkt-gap', '12:01:00', 'finished', 'Carrier gateways shut down.')
  storeRun('run-cap', 'mkt-cap', '12:02:00', 'finished', 'Carrier gateways shut down.')
  storeRun(
    'run-secret',
    'mkt-secret',
    '12:03:00',
    'finished',
    `The setup uses ${PLANTED} and ${PLANTED_EXACT}.`
  )
  storeRun('run-cancelled', 'mkt-cancelled', '12:04:00', 'cancelled', 'Carrier gateways shut down.')
  storeRun('run-error', 'mkt-error', '12:05:00', 'error', null)
})

afterAll(() => {
  closeProjectDatabase(db)
  rmSync(directory, { recursive: true, force: true })
})

describe('check report analyses', () => {
  test('a cancelled run and an error run record no generations or analyses', async () => {
    const before = generationIds()
    await expect(write('run-cancelled', refusingProvider())).resolves.toBe('skipped')
    await expect(write('run-error', refusingProvider())).resolves.toBe('skipped')
    expect(generationIds()).toEqual(before)
    expect(listAnalysesByRun(db, 'run-cancelled')).toEqual([])
    expect(listAnalysesByRun(db, 'run-error')).toEqual([])
  })

  test('a finished gap run records two generations and two linked analyses', async () => {
    const before = new Set(generationIds())
    const existing = before.size
    const caps: GenerationCallCaps = { daily: existing + 2, monthly: existing + 2 }
    await expect(write('run-gap', okProvider(), [], caps)).resolves.toBe('written')
    const added = listGenerations(db, 'page-1').filter((row) => !before.has(row.id))
    expect(added.map((row) => row.kind).sort()).toEqual(['aio_gap', 'summary'])
    for (const row of added) {
      expect(row.model).toBe('claude-test')
      expect(row.ok).toBe(true)
      expect(row.usage).toEqual(USAGE)
      expect(row.pageId).toBe('page-1')
    }
    const analyses = listAnalysesByRun(db, 'run-gap')
    expect(analyses).toHaveLength(2)
    expect(listAnalysesByMarket(db, 'mkt-gap').map((row) => row.id)).toEqual(
      analyses.map((row) => row.id)
    )
    const gap = analyses.find((row) => row.kind === 'aio_gap')
    const summary = analyses.find((row) => row.kind === 'summary')
    expect(gap).toMatchObject({
      runId: 'run-gap',
      snapshotId: null,
      marketId: 'mkt-gap',
      promptId: 'prompt-1',
      generationId: added.find((row) => row.kind === 'aio_gap')?.id,
      templateHash: AIO_GAP_TEMPLATE.hash,
      done: true,
      body: {
        prompts: [
          {
            promptId: 'prompt-1',
            facts: [
              {
                fact: 'Carrier gateways shut down.',
                likelySource: 'https://simpletexting.com/a'
              }
            ]
          }
        ]
      }
    })
    expect(summary).toMatchObject({
      runId: 'run-gap',
      snapshotId: null,
      marketId: 'mkt-gap',
      promptId: null,
      generationId: added.find((row) => row.kind === 'summary')?.id,
      templateHash: RUN_SUMMARY_TEMPLATE.hash,
      done: true
    })
    expect(aioGapPath(reportsRoot, 'proj-1', 'run-gap').endsWith('aio_gap.md')).toBe(true)
    expect(runSummaryPath(reportsRoot, 'proj-1', 'run-gap').endsWith('run_summary.md')).toBe(true)

    let calls = 0
    const lines: string[] = []
    await write(
      'run-cap',
      {
        id: 'claude-code',
        async complete(): Promise<ClaudeCompletion> {
          calls += 1
          return completion(false)
        }
      },
      [],
      caps,
      lines
    )
    expect(calls).toBe(0)
    expect(lines.join('\n')).toContain('The daily CiteFox AI cap is reached')
    expect(listGenerations(db, 'page-1').filter((row) => !before.has(row.id))).toHaveLength(2)
  })

  test('a planted key is redacted in the generation and the analysis', async () => {
    const before = new Set(generationIds())
    const seen: string[] = []
    const lines: string[] = []
    await write(
      'run-secret',
      {
        id: 'claude-code',
        async complete(request): Promise<ClaudeCompletion> {
          seen.push(request.prompt)
          if (request.prompt.startsWith('Template: run_summary.md')) {
            throw new Error(`summary failed ${PLANTED} ${PLANTED_EXACT}`)
          }
          return completion(true)
        }
      },
      [PLANTED_EXACT],
      undefined,
      lines
    )
    for (const prompt of seen) {
      expect(prompt).not.toContain(PLANTED)
      expect(prompt).not.toContain(PLANTED_EXACT)
    }
    expect(lines.join('\n')).not.toContain(PLANTED)
    expect(lines.join('\n')).not.toContain(PLANTED_EXACT)
    const added = listGenerations(db, 'page-1').filter((row) => !before.has(row.id))
    const gap = added.find((row) => row.kind === 'aio_gap')
    const summary = added.find((row) => row.kind === 'summary')
    expect(gap?.ok).toBe(true)
    expect(summary?.ok).toBe(false)
    const storedGap = outputOf(gap?.id ?? '')
    const storedError = errorOf(summary?.id ?? '')
    expect(storedGap).not.toContain(PLANTED)
    expect(storedGap).not.toContain(PLANTED_EXACT)
    expect(storedGap).toContain('[REDACTED]')
    expect(storedError).not.toContain(PLANTED)
    expect(storedError).not.toContain(PLANTED_EXACT)
    const analyses = listAnalysesByRun(db, 'run-secret')
    const encoded = JSON.stringify(analyses)
    expect(encoded).not.toContain(PLANTED)
    expect(encoded).not.toContain(PLANTED_EXACT)
    expect(analyses.find((row) => row.kind === 'aio_gap')?.generationId).toBe(gap?.id)
    expect(analyses.find((row) => row.kind === 'summary')?.done).toBe(false)
  })

  test('a profile rewrite that replaces markets keeps the run analyses listed', async () => {
    await write('run-gap', okProvider())
    const byRun = listAnalysesByRun(db, 'run-gap')
    const byMarket = listAnalysesByMarket(db, 'mkt-gap')
    expect(byRun).toHaveLength(2)
    expect(byMarket).toEqual(byRun)
    expect(
      db.prepare<unknown[], { id: string }>(`SELECT id FROM markets WHERE id = 'mkt-gap'`).get()?.id
    ).toBe('mkt-gap')
    try {
      writeProjectProfile(db, {
        includeSubdomains: false,
        brandNames: ['TextBolt'],
        competitors: ['SimpleTexting'],
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
      expect(
        db.prepare<unknown[], { id: string }>(`SELECT id FROM markets ORDER BY id`).all()
      ).toEqual([{ id: 'mkt-us' }])
      expect(listAnalysesByRun(db, 'run-gap')).toEqual(byRun)
      expect(listAnalysesByMarket(db, 'mkt-gap')).toEqual(byMarket)
    } finally {
      restoreReplacedMarkets()
    }
  })
})

function generationIds(): string[] {
  return listGenerations(db, 'page-1').map((row) => row.id)
}

function restoreReplacedMarkets(): void {
  for (const market of MARKETS) {
    if (market.id === 'mkt-us') continue
    const existing = db
      .prepare<unknown[], { id: string }>(`SELECT id FROM markets WHERE id = ?`)
      .get(market.id)
    if (existing !== undefined) continue
    insertMarket(db, {
      id: market.id,
      country: market.country,
      language: market.language,
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    })
  }
}

function outputOf(id: string): string {
  return (
    db
      .prepare<unknown[], { output_json: string | null }>(
        `SELECT output_json FROM generations WHERE id = ?`
      )
      .get(id)?.output_json ?? ''
  )
}

function errorOf(id: string): string {
  return (
    db
      .prepare<unknown[], { error: string | null }>(`SELECT error FROM generations WHERE id = ?`)
      .get(id)?.error ?? ''
  )
}

function write(
  runId: string,
  claude: ClaudeProvider,
  secrets: readonly string[] = [],
  caps?: GenerationCallCaps,
  lines?: string[]
): Promise<'written' | 'skipped'> {
  return writeCheckReports({
    db,
    projectId: 'proj-1',
    runId,
    domain: 'textbolt.com',
    reportsRoot,
    claude,
    secrets,
    caps,
    logger: createLogger({
      secrets,
      hexKeys: true,
      write: (_level, line) => {
        lines?.push(line)
      }
    })
  })
}

function refusingProvider(): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(): Promise<ClaudeCompletion> {
      throw new Error('should not be called')
    }
  }
}

function okProvider(): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request): Promise<ClaudeCompletion> {
      return completion(false, request.prompt.startsWith('Template: aio_gap.md'))
    }
  }
}

function completion(secret: boolean, gap = true): ClaudeCompletion {
  const json = gap
    ? {
        facts: [
          {
            fact: secret ? `The overview names ${PLANTED}.` : 'Carrier gateways shut down.',
            likelySource: secret ? PLANTED_EXACT : 'https://simpletexting.com/a'
          }
        ]
      }
    : { headline: 'Counts stay.', body: 'The check states both facts.' }
  return {
    provider: 'claude-code',
    text: JSON.stringify(json),
    json,
    inputTokens: USAGE.inputTokens,
    outputTokens: USAGE.outputTokens,
    durationMs: 4,
    model: 'claude-test',
    resolvedModel: 'claude-test',
    usage: {
      ...emptyClaudeCliUsage(),
      inputTokens: USAGE.inputTokens,
      outputTokens: USAGE.outputTokens,
      cacheReadInputTokens: USAGE.cacheReadTokens,
      cacheCreationInputTokens: USAGE.cacheCreationTokens
    }
  }
}

function storeRun(
  id: string,
  marketId: string,
  clock: string,
  status: 'finished' | 'cancelled' | 'error',
  aioText: string | null
): void {
  const startedAt = `2026-10-19T${clock}.000Z`
  insertStoredRun(db, {
    id,
    jobId: 'job-1',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId,
    startedAt,
    kind: 'baseline',
    partial: false,
    samples: 1,
    contentHash: contentHash(BODY)
  })
  finishStoredRun(db, id, startedAt, status)
  const sampleStatus: PromptCheckStatus = status === 'error' ? 'error' : 'not_cited'
  insertStoredSerpResult(db, {
    id: `serp-${id}`,
    runId: id,
    promptId: 'prompt-1',
    sampleNo: 1,
    keyId: null,
    hasAio: aioText !== null,
    neededFollowup: false,
    searches: status === 'error' ? 0 : 1,
    status: sampleStatus,
    named: false,
    citedUrl: null,
    position: null,
    aioText,
    errorCode: status === 'error' ? 'other' : null,
    message: null,
    nextStep: null,
    rawSearchJson: null,
    rawAioJson: null,
    references: aioText === null ? [] : [reference(`ref-${id}`)]
  })
}

function reference(id: string): NewAioReference {
  return {
    id,
    position: 1,
    url: 'https://simpletexting.com/a',
    normalizedUrl: 'https://simpletexting.com/a',
    domain: 'simpletexting.com',
    title: 'Text employees',
    classification: 'competitor',
    untracked: false,
    sourceType: 'web'
  }
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: PAGE_URL,
    title: 'Alerts',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 5,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function snapshot(): StoredSnapshot {
  return {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: NOW,
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Alerts',
    metaDescription: 'Email to SMS',
    h1: 'Text alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 1,
    h3Count: 0,
    tableCount: 0,
    bodyText: BODY,
    wordCount: wordCount(BODY),
    contentHash: contentHash(BODY),
    summary: null
  }
}

function buyer(): BuyerProfile {
  return {
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
    createdAt: NOW,
    promptsStale: false
  }
}

function promptSet(): NewPromptSet {
  return {
    id: 'pset-1',
    pageId: 'page-1',
    version: 1,
    savedAt: NOW,
    icpId: 'icp-1',
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    prompts: [prompt('prompt-1', 'Gateway', 'What happens when a carrier gateway shuts down?')]
  }
}

function prompt(id: string, label: string, text: string): BuyerPrompt {
  return {
    id,
    position: 1,
    label,
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: MARKETS.map((market) => ({
      marketId: market.id,
      language: market.language,
      text,
      originalText: null
    }))
  }
}
