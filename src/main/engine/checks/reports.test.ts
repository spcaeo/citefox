import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PromptCheckStatus } from '@shared/domain'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createLogger } from '../../logging/logger'
import { contentHash } from '../../pipeline/hash'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import type { AtomicFileIo } from '../../storage/atomic-file'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  type NewAioReference
} from '../../storage/check-records'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type NewPromptSet
} from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { addPageMarket, insertPage } from '../../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../storage/project-files'
import { insertMarket, writeProjectProfile } from '../../storage/project-profile'
import {
  CheckTemplateError,
  renderCheckTemplate,
  type CheckTemplateContext
} from './report-templates'
import { createLimiter } from './check-pace'
import { aioGapPath, runSummaryPath } from './report-files'
import { loadPageResults, loadPromptDetail, type ResultsLoad } from './results'
import { writeCheckReports } from './reports'
import {
  BODY,
  buyer,
  EXPECTED,
  MARKETS,
  NOW,
  page,
  PAGE_URL,
  PLANTED,
  PLANTED_EXACT,
  prompt,
  provider,
  read,
  snapshot
} from './reports.test-helper'

let db: SqliteDatabase
let reportsRoot: string
let directory: string

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'citefox-reports-'))
  reportsRoot = join(directory, 'check-reports')
  db = createProjectDatabase(directory, 'textbolt')
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['SimpleTexting', 'Twilio'],
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
      device: market.device,
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
  storeRun('run-cited', 'mkt-cited', 'prompt-cited', '12:01:00', 'finished', {
    status: 'page_cited',
    hasAio: true,
    named: true,
    position: 1,
    citedUrl: PAGE_URL,
    aioText: 'You can text employees without a developer.',
    references: [ref('ref-cited', PAGE_URL, 'textbolt.com', 'Alerts', 'target')]
  })
  storeRun('run-noaio', 'mkt-noaio', 'prompt-noaio', '12:02:00', 'finished', {
    status: 'no_aio',
    hasAio: false,
    named: null,
    position: null,
    citedUrl: null,
    aioText: null,
    references: []
  })
  storeRun('run-gap', 'mkt-gap', 'prompt-gap', '12:03:00', 'finished', {
    status: 'not_cited',
    hasAio: true,
    named: false,
    position: null,
    citedUrl: null,
    aioText: 'Carrier gateways shut down and email-to-text stops.',
    references: [
      ref(
        'ref-gap',
        'https://simpletexting.com/blog/text-employees/',
        'simpletexting.com',
        'Text employees',
        'competitor'
      )
    ]
  })
  storeRun('run-secret', 'mkt-secret', 'prompt-secret', '12:04:00', 'finished', {
    status: 'not_cited',
    hasAio: true,
    named: false,
    position: null,
    citedUrl: null,
    aioText: `The setup uses ${PLANTED} and ${PLANTED_EXACT}.`,
    references: [
      ref(
        'ref-secret',
        'https://simpletexting.com/blog/text-employees/',
        'simpletexting.com',
        'Text employees',
        'competitor'
      )
    ]
  })
  storeRun('run-us', 'mkt-us', 'prompt-markets', '12:05:00', 'finished', {
    status: 'not_cited',
    hasAio: true,
    named: false,
    position: null,
    citedUrl: null,
    aioText: 'Carrier gateways shut down and email-to-text stops.',
    references: [
      ref(
        'ref-us',
        'https://simpletexting.com/blog/text-employees/',
        'simpletexting.com',
        'Text employees',
        'competitor'
      )
    ]
  })
  storeRun('run-mx', 'mkt-mx', 'prompt-markets', '12:06:00', 'finished', {
    status: 'not_cited',
    hasAio: true,
    named: false,
    position: null,
    citedUrl: null,
    aioText: 'Carrier gateways shut down and email-to-text stops.',
    references: [
      ref(
        'ref-mx',
        'https://simpletexting.com/blog/text-employees/',
        'simpletexting.com',
        'Text employees',
        'competitor'
      )
    ]
  })
  storeRun('run-cancelled', 'mkt-cancelled', 'prompt-gap', '12:07:00', 'cancelled', {
    status: 'not_cited',
    hasAio: true,
    named: false,
    position: null,
    citedUrl: null,
    aioText: 'Carrier gateways shut down and email-to-text stops.',
    references: []
  })
  storeRun('run-error', 'mkt-error', 'prompt-gap', '12:08:00', 'error', {
    status: 'error',
    hasAio: false,
    named: null,
    position: null,
    citedUrl: null,
    aioText: null,
    references: []
  })
})

afterAll(() => {
  closeProjectDatabase(db)
  rmSync(directory, { recursive: true, force: true })
})

describe('check report files', () => {
  test('an unknown template variable fails the render', () => {
    expect(() => renderCheckTemplate('Hello {{ nope }}', emptyContext())).toThrow(
      CheckTemplateError
    )
  })

  test('a run that cites the page writes both files and does not ask Claude for a gap', async () => {
    const seen: string[] = []
    await write('run-cited', provider('aio-gap.json', seen))
    const gap = read(aioGapPath(reportsRoot, 'proj-1', 'run-cited'))
    const summary = read(runSummaryPath(reportsRoot, 'proj-1', 'run-cited'))
    expectSnapshot('cited-aio-gap.md', gap)
    expectSnapshot('cited-run-summary.md', summary)
    expect(seen.some((prompt) => prompt.startsWith('Template: aio_gap.md'))).toBe(false)
    expect(seen.some((prompt) => prompt.startsWith('Template: run_summary.md'))).toBe(true)
    const results = loadPageResults(db, load('mkt-cited', 'run-cited'))
    expect(results.runSummary?.headline).toBe(
      '**1** AIOs shown, **1** page cited, **0** other own page, **0** named without a link, **0** invisible.'
    )
    expect(results.runSummary?.body).toContain(
      'does not say that a content edit produced a citation change'
    )
    const detail = loadPromptDetail(db, {
      ...load('mkt-cited', 'run-cited'),
      promptId: 'prompt-cited'
    })
    expect(detail.aioGap).toBeNull()
  })

  test('a run with no AI Overview writes a summary and does not compare a snapshot', async () => {
    await write('run-noaio', provider('aio-gap.json'))
    expectSnapshot('noaio-aio-gap.md', read(aioGapPath(reportsRoot, 'proj-1', 'run-noaio')))
    expectSnapshot('noaio-run-summary.md', read(runSummaryPath(reportsRoot, 'proj-1', 'run-noaio')))
    const detail = loadPromptDetail(db, {
      ...load('mkt-noaio', 'run-noaio'),
      promptId: 'prompt-noaio'
    })
    expect(detail.aioGap).toBeNull()
  })

  test('a page that is not cited lists the missing fact and its likely source', async () => {
    await write('run-gap', provider('aio-gap.json'))
    expectSnapshot('gap-aio-gap.md', read(aioGapPath(reportsRoot, 'proj-1', 'run-gap')))
    expectSnapshot('gap-run-summary.md', read(runSummaryPath(reportsRoot, 'proj-1', 'run-gap')))
    const detail = loadPromptDetail(db, { ...load('mkt-gap', 'run-gap'), promptId: 'prompt-gap' })
    expect(detail.aioGap).toEqual([
      {
        fact: 'Carrier gateways shut down and email-to-text stops.',
        likelySource: 'https://simpletexting.com/blog/text-employees/'
      }
    ])
  })

  test('two markets each get their own files', async () => {
    await write('run-us', provider('aio-gap.json'))
    await write('run-mx', provider('aio-gap.json'))
    const us = read(aioGapPath(reportsRoot, 'proj-1', 'run-us'))
    const mx = read(aioGapPath(reportsRoot, 'proj-1', 'run-mx'))
    expectSnapshot('market-us-aio-gap.md', us)
    expectSnapshot('market-mx-aio-gap.md', mx)
    expectSnapshot(
      'market-us-run-summary.md',
      read(runSummaryPath(reportsRoot, 'proj-1', 'run-us'))
    )
    expectSnapshot(
      'market-mx-run-summary.md',
      read(runSummaryPath(reportsRoot, 'proj-1', 'run-mx'))
    )
    expect(us).toContain('Market: US · en · desktop')
    expect(mx).toContain('Market: MX · es · mobile')
    expect(us).toContain('How do I alert the crew when a gateway shuts down?')
    expect(mx).toContain('Como aviso al equipo si el operador corta los SMS?')
    expect(us).not.toBe(mx)
  })

  test('a planted key is redacted in the file and in the Claude prompt', async () => {
    const seen: string[] = []
    await write('run-secret', provider('aio-gap-secret.json', seen), [PLANTED_EXACT])
    const gap = read(aioGapPath(reportsRoot, 'proj-1', 'run-secret'))
    const summary = read(runSummaryPath(reportsRoot, 'proj-1', 'run-secret'))
    expectSnapshot('secret-aio-gap.md', gap)
    expectSnapshot('secret-run-summary.md', summary)
    expect(gap).not.toContain(PLANTED)
    expect(gap).not.toContain(PLANTED_EXACT)
    expect(summary).not.toContain(PLANTED)
    expect(summary).not.toContain(PLANTED_EXACT)
    expect(gap).toContain('[REDACTED]')
    for (const prompt of seen) {
      expect(prompt).not.toContain(PLANTED)
      expect(prompt).not.toContain(PLANTED_EXACT)
    }
  })

  test('a failed rename leaves the previous report in place', async () => {
    await write('run-cited', provider('aio-gap.json'))
    const beforeGap = read(aioGapPath(reportsRoot, 'proj-1', 'run-cited'))
    const beforeSummary = read(runSummaryPath(reportsRoot, 'proj-1', 'run-cited'))
    const io: AtomicFileIo = {
      write: (file, contents) => writeFileSync(file, contents),
      rename() {
        throw new Error('disk full')
      },
      unlink(file) {
        try {
          unlinkSync(file)
        } catch {
          // The temp file is already gone when the write itself failed.
        }
      }
    }
    await expect(write('run-cited', provider('aio-gap.json'), [], io)).rejects.toThrow(/disk full/)
    expect(read(aioGapPath(reportsRoot, 'proj-1', 'run-cited'))).toBe(beforeGap)
    expect(read(runSummaryPath(reportsRoot, 'proj-1', 'run-cited'))).toBe(beforeSummary)
    expect(
      readdirSync(join(reportsRoot, 'proj-1', 'run-cited')).filter((name) => name.endsWith('.tmp'))
    ).toEqual([])
  })

  test('a cancelled run and an error run write no files', async () => {
    let calls = 0
    const claude: ClaudeProvider = {
      id: 'claude-code',
      async complete() {
        calls += 1
        throw new Error('should not be called')
      }
    }
    await expect(write('run-cancelled', claude)).resolves.toBe('skipped')
    await expect(write('run-error', claude)).resolves.toBe('skipped')
    expect(calls).toBe(0)
    expect(existsSync(aioGapPath(reportsRoot, 'proj-1', 'run-cancelled'))).toBe(false)
    expect(existsSync(runSummaryPath(reportsRoot, 'proj-1', 'run-cancelled'))).toBe(false)
    expect(existsSync(aioGapPath(reportsRoot, 'proj-1', 'run-error'))).toBe(false)
    expect(existsSync(runSummaryPath(reportsRoot, 'proj-1', 'run-error'))).toBe(false)
  })
})

describe('gap questions side by side', () => {
  test('with a limiter of two, both prompts are asked at once and kept in prompt order', async () => {
    storeRun('run-pair', 'mkt-gap', 'prompt-gap', '12:09:00', 'finished', {
      status: 'not_cited',
      hasAio: true,
      named: false,
      position: null,
      citedUrl: null,
      aioText: 'Carrier gateways shut down and email-to-text stops.',
      references: []
    })
    insertStoredSerpResult(db, {
      id: 'serp-run-pair-2',
      runId: 'run-pair',
      promptId: 'prompt-noaio',
      sampleNo: 1,
      keyId: null,
      hasAio: true,
      neededFollowup: false,
      searches: 1,
      status: 'not_cited',
      named: false,
      citedUrl: null,
      position: null,
      aioText: 'Carrier gateways shut down and email-to-text stops.',
      rawSearchJson: null,
      rawAioJson: null,
      errorCode: null,
      message: null,
      nextStep: null,
      references: []
    })
    const inner = provider('aio-gap.json')
    let gapsInFlight = 0
    let most = 0
    let release: () => void = () => undefined
    const bothAsked = new Promise<void>((resolve) => {
      release = resolve
    })
    const claude: ClaudeProvider = {
      id: 'claude-code',
      async complete(request) {
        if (!request.prompt.startsWith('Template: aio_gap.md')) return inner.complete(request)
        gapsInFlight += 1
        most = Math.max(most, gapsInFlight)
        if (gapsInFlight === 2) release()
        // Neither gap answers until both are asked: one at a time would never finish.
        await bothAsked
        gapsInFlight -= 1
        return inner.complete(request)
      }
    }
    const written = await writeCheckReports({
      db,
      projectId: 'proj-1',
      runId: 'run-pair',
      domain: 'textbolt.com',
      reportsRoot,
      claude,
      logger: createLogger({ write: () => undefined }),
      limiter: createLimiter(2)
    })
    expect(written).toBe('written')
    expect(most).toBe(2)
    const gap = read(aioGapPath(reportsRoot, 'proj-1', 'run-pair'))
    const quiet = gap.indexOf('What happens when the overview is missing?')
    const gateway = gap.indexOf('What happens when a carrier gateway shuts down?')
    expect(quiet).toBeGreaterThan(-1)
    expect(gateway).toBeGreaterThan(quiet)
  })
})

function expectSnapshot(name: string, actual: string): void {
  expect(actual).toBe(readFileSync(join(EXPECTED, name), 'utf8'))
}

function write(
  runId: string,
  claude: ClaudeProvider,
  secrets: readonly string[] = [],
  io?: AtomicFileIo
): Promise<'written' | 'skipped'> {
  return writeCheckReports({
    db,
    projectId: 'proj-1',
    runId,
    domain: 'textbolt.com',
    reportsRoot,
    claude,
    secrets,
    logger: createLogger({ write: () => undefined }),
    ...(io === undefined ? {} : { io })
  })
}

function load(marketId: string, runId: string): ResultsLoad {
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    marketId,
    runId,
    builtAt: '2026-10-20T12:00:00.000Z',
    domain: 'textbolt.com',
    keyLabels: new Map<string, string>(),
    reportsRoot
  }
}

interface StoredSample {
  status: PromptCheckStatus
  hasAio: boolean
  named: boolean | null
  position: number | null
  citedUrl: string | null
  aioText: string | null
  references: ReturnType<typeof ref>[]
}

function storeRun(
  id: string,
  marketId: string,
  promptId: string,
  clock: string,
  status: 'finished' | 'cancelled' | 'error',
  sample: StoredSample
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
  insertStoredSerpResult(db, {
    id: `serp-${id}`,
    runId: id,
    promptId,
    sampleNo: 1,
    keyId: null,
    hasAio: sample.hasAio,
    neededFollowup: false,
    searches: sample.status === 'error' ? 0 : 1,
    status: sample.status,
    named: sample.named,
    citedUrl: sample.citedUrl,
    position: sample.position,
    aioText: sample.aioText,
    errorCode: sample.status === 'error' ? 'other' : null,
    message: null,
    nextStep: null,
    rawSearchJson: null,
    rawAioJson: null,
    references: sample.references
  })
}

function ref(
  id: string,
  url: string,
  domain: string,
  title: string,
  classification: 'target' | 'own' | 'competitor' | 'other'
): NewAioReference {
  return {
    id,
    position: 1,
    url,
    normalizedUrl: url,
    domain,
    title,
    classification,
    untracked: false,
    sourceType: 'web' as const
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
    prompts: [
      prompt(
        'prompt-cited',
        1,
        'Crew',
        'How do I alert the crew without a developer?',
        'all',
        'en'
      ),
      prompt('prompt-noaio', 2, 'Quiet', 'What happens when the overview is missing?', 'all', 'en'),
      prompt(
        'prompt-gap',
        3,
        'Gateway',
        'What happens when a carrier gateway shuts down?',
        'all',
        'en'
      ),
      prompt('prompt-secret', 4, 'Planted', 'Where is the planted key mentioned?', 'all', 'en'),
      prompt(
        'prompt-markets',
        5,
        'Local',
        'How do I alert the crew when a gateway shuts down?',
        'split',
        'en'
      )
    ]
  }
}

function emptyContext(): CheckTemplateContext {
  return {
    page: { url: '', title: '', meta_description: '', h1: '', body: '' },
    market: { country: '', language: '', location: '', device: '' },
    icp: '',
    product: '',
    brand_names: '',
    competitors: '',
    count: '0',
    prompts: '',
    aio: { prompt: '', text: '', references: '', status: '' },
    run: {
      aios_shown: '0',
      page_cited: '0',
      other_own_page: '0',
      named_without_link: '0',
      invisible: '0',
      previous_page_cited: 'none',
      baseline_page_cited: 'none',
      content_changed: 'no',
      content_change: ''
    },
    notes: ''
  }
}
