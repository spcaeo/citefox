import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { PageResults, PromptCheckStatus } from '@shared/domain'
import type { IpcHandlerMap, ProjectCheck } from '@shared/ipc'
import { closeSeeds, envelope, seed as checksSeed } from '../engine/checks/checks.test-helper'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../storage/check-records'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  closeSeeds()
})

const AIO = new Set<PromptCheckStatus>([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])
const base = { projectId: PROGRESS_SEED.projectId }

describe('history:listProject (Check history) on real IPC', () => {
  test('no checks yet: no rows and no subjects', async () => {
    const seed = open()
    const history = await seed.handlers['history:listProject'](base)
    expect(history.projectId).toBe(PROGRESS_SEED.projectId)
    expect(history.checks).toEqual([])
    expect(history.subjects).toEqual([])
    expect(history.markets.map((market) => market.id)).toEqual([PROGRESS_SEED.us, PROGRESS_SEED.uk])
  })

  test('one row per check and market, newest first, matching the Results each one opens', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    const [one] = PROGRESS_SEED.prompts
    // A re-check of one question: a partial check in both markets.
    await seed.check('2026-10-12T12:00:00.000Z', [one.id])
    await seed.check(PROGRESS_SEED.second)

    const history = await seed.handlers['history:listProject'](base)
    expect(history.subjects).toEqual([
      {
        id: PROGRESS_SEED.pageId,
        kind: 'page',
        label: 'Alerts',
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
      }
    ])
    expect(history.checks).toHaveLength(6)
    const started = history.checks.map((check) => check.startedAt)
    expect([...started].sort().reverse()).toEqual(started)
    expect(history.checks.filter((check) => check.partial)).toHaveLength(2)
    for (const check of history.checks) {
      expect(check.status).toBe('finished')
      expect(check.durationMs).not.toBeNull()
      expect(check.questionsTotal).toBe(3)
      expect(check.questionsChecked).toBe(check.partial ? 1 : 3)
      expect(check.searchesUsed).toBeGreaterThanOrEqual(check.questionsChecked)
      expectMatchesResults(check, await resultsOf(seed.handlers, check), false)
    }
  })

  test('score and change match the page History tab and Results for every check', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    const [one, , three] = PROGRESS_SEED.prompts
    await seed.check('2026-10-12T12:00:00.000Z', [one.id])
    // The third question is now cited in the US: the score moves up there.
    seed.bodies.set(`us|${three.text}`, 'google-ai-overview.json')
    await seed.check(PROGRESS_SEED.second)

    const history = await seed.handlers['history:listProject'](base)
    expect(history.trackedCount).toBe(1)
    const changes = history.checks.map((check) => check.scoreChange)
    expect(changes.some((change) => change !== null && change > 0)).toBe(true)
    for (const marketId of [PROGRESS_SEED.us, PROGRESS_SEED.uk]) {
      const page = await seed.handlers['history:list']({
        ...base,
        pageId: PROGRESS_SEED.pageId,
        marketId
      })
      const events = page.events.flatMap((event) => (event.check ? [event.check] : []))
      const rows = history.checks.filter((check) => check.marketId === marketId)
      expect(rows.map((row) => row.runId)).toEqual(events.map((event) => event.runId))
      for (const row of rows) {
        const event = events.find((item) => item.runId === row.runId)!
        expect(row.score).toBe(event.score)
        expect(row.scoreChange).toBe(event.scoreChange)
        const results = await resultsOf(seed.handlers, row)
        expect(row.score).toBe(results.run?.visibilityScore ?? null)
        expect(row.samples).toBe(1)
        expect(row.failedPromptIds).toEqual([])
        expect(row.promptIds).toEqual(row.partial ? [one.id] : null)
      }
    }
  })

  test('several samples per question roll up as Results does (section 7.1)', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    const [one, two, three] = PROGRESS_SEED.prompts
    insertRun(seed, 'run-samples', [
      // Two of three cite the page: cited; the first winning sample (2) names the brand.
      [one.id, 1, 'not_cited', false],
      [one.id, 2, 'page_cited', true],
      [one.id, 3, 'page_cited', false],
      // An error loses; no AIO and brand mentioned tie on count, the higher points win.
      [two.id, 1, 'error', null],
      [two.id, 2, 'no_aio', null],
      [two.id, 3, 'brand_mentioned', true],
      // Only errors: an error, never an AI Overview.
      [three.id, 1, 'error', null],
      [three.id, 2, 'error', null],
      [three.id, 3, 'error', null]
    ])

    const history = await seed.handlers['history:listProject'](base)
    const check = history.checks.find((item) => item.runId === 'run-samples')
    expect(check).toMatchObject({
      questionsChecked: 3,
      aiOverviews: 2,
      cited: 1,
      named: 2,
      searchesUsed: 9,
      durationMs: 90_000,
      kind: 'manual',
      partial: false
    })
    expectMatchesResults(check!, await resultsOf(seed.handlers, check!), false)
  })

  test('each check carries its credits, cost, provider and engines', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    const [one, two] = PROGRESS_SEED.prompts
    insertRun(seed, 'run-cloro', [
      [one.id, 1, 'page_cited', false],
      [two.id, 1, 'not_cited', false]
    ])
    const db = openProjectDatabase(seed.storage.paths.projectsDirectory, 'textbolt')
    try {
      db.prepare(
        "UPDATE serp_results SET provider = 'cloro', credits = 7, cost_micros = 5600 WHERE run_id = 'run-cloro'"
      ).run()
      db.prepare(
        `UPDATE runs SET engines_json = '["chatgpt","google_aio"]' WHERE id = 'run-cloro'`
      ).run()
      db.prepare(
        `INSERT INTO engine_answers (id, run_id, prompt_id, sample_no, engine, status, credits,
           cost_micros, checked_at)
         VALUES ('ans-1', 'run-cloro', ?, 1, 'chatgpt', 'not_cited', 7, 5600, ?)`
      ).run(one.id, '2026-10-20T12:00:30.000Z')
    } finally {
      closeProjectDatabase(db)
    }

    const history = await seed.handlers['history:listProject'](base)
    const cloro = history.checks.find((item) => item.runId === 'run-cloro')
    expect(cloro).toMatchObject({
      credits: 21,
      costMicros: 16_800,
      provider: 'cloro',
      engines: ['google_aio', 'chatgpt']
    })
    // Checks from before cloro: SerpApi, Google only, and no recorded cost.
    const before = history.checks.find((item) => item.runId !== 'run-cloro')
    expect(before).toMatchObject({ credits: 0, provider: 'serpapi', engines: ['google_aio'] })
  })

  test('a removed page drops out; a malformed request is refused', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    await seed.handlers['pages:remove']({ ...base, pageId: PROGRESS_SEED.pageId })
    const history = await seed.handlers['history:listProject'](base)
    expect(history.checks).toEqual([])
    expect(history.subjects).toEqual([])
    await expect(
      seed.handlers['history:listProject']({ ...base, extra: 1 } as never)
    ).rejects.toThrow()
    await expect(seed.handlers['history:listProject']({ projectId: '../x' })).rejects.toThrow()
  })

  test('a topic’s checks are listed with its name, and any own page counts as cited', async () => {
    const { handlers } = await checksSeed({
      progress: [],
      http(request) {
        const url = new URL(request.url)
        return url.searchParams.get('engine') === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const draft = await handlers['topics:createDraft']({
      projectId: 'proj-1',
      path: 'questions',
      name: 'Crew alerts'
    })
    await handlers['topics:importQuestions']({
      projectId: 'proj-1',
      draftId: draft.id,
      text: 'How do I send an urgent text to my whole field crew from Outlook?\nWhat is the cheapest way to text forty employees a schedule change?'
    })
    const started = await handlers['topics:start']({
      projectId: 'proj-1',
      draftId: draft.id,
      plan: 'all_now'
    })
    await waitForJob(handlers, started.jobId ?? '')

    const history = await handlers['history:listProject']({ projectId: 'proj-1' })
    const subject = history.subjects.find((item) => item.id === started.topicId)
    expect(subject).toEqual({ id: started.topicId, kind: 'topic', label: 'Crew alerts', url: null })
    const checks = history.checks.filter((check) => check.pageId === started.topicId)
    expect(checks).toHaveLength(1)
    const check = checks[0]!
    expect(check.questionsChecked).toBe(2)
    expectMatchesResults(check, await resultsOf(handlers, check, 'proj-1'), true)
  })
})

function open(): ProgressSeed {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-history-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  return seed
}

function resultsOf(
  handlers: IpcHandlerMap,
  check: ProjectCheck,
  projectId: string = PROGRESS_SEED.projectId
): Promise<PageResults> {
  return Promise.resolve(
    handlers['results:get']({
      projectId,
      pageId: check.pageId,
      marketId: check.marketId,
      runId: check.runId
    })
  )
}

/** The row's counts are the counts of the Results screen it opens. */
function expectMatchesResults(check: ProjectCheck, results: PageResults, topic: boolean): void {
  expect(results.run?.runId).toBe(check.runId)
  const metrics = results.run!
  expect(check.questionsChecked).toBe(metrics.promptsChecked)
  expect(check.aiOverviews).toBe(metrics.promptsWithAio)
  expect(check.score).toBe(metrics.visibilityScore)
  expect(check.cited).toBe(topic ? metrics.pageCited + metrics.otherOwnPage : metrics.pageCited)
  expect(check.named).toBe(
    results.prompts.filter((row) => AIO.has(row.status) && row.named === true).length
  )
}

type Sample = [promptId: string, sampleNo: number, status: PromptCheckStatus, named: boolean | null]

/** A finished three-sample check in the US, written straight to storage. */
function insertRun(seed: ProgressSeed, runId: string, samples: readonly Sample[]): void {
  const db = openProjectDatabase(seed.storage.paths.projectsDirectory, 'textbolt')
  try {
    const startedAt = '2026-10-20T12:00:00.000Z'
    insertStoredCheckJob(db, {
      id: `job-${runId}`,
      startedAt,
      status: 'running',
      pageIds: [PROGRESS_SEED.pageId],
      marketIds: [PROGRESS_SEED.us],
      promptIds: null,
      reason: 'manual',
      message: null,
      nextStep: null
    })
    const snapshot = db
      .prepare<unknown[], { id: string; content_hash: string }>(
        'SELECT id, content_hash FROM snapshots ORDER BY fetched_at DESC LIMIT 1'
      )
      .get()!
    insertStoredRun(db, {
      id: runId,
      jobId: `job-${runId}`,
      pageId: PROGRESS_SEED.pageId,
      promptSetId: 'pset-1',
      snapshotId: snapshot.id,
      marketId: PROGRESS_SEED.us,
      startedAt,
      kind: 'manual',
      partial: false,
      samples: 3,
      contentHash: snapshot.content_hash
    })
    samples.forEach(([promptId, sampleNo, status, named], index) => {
      const aio = AIO.has(status)
      insertStoredSerpResult(db, {
        id: `${runId}-s${index}`,
        runId,
        promptId,
        sampleNo,
        keyId: null,
        hasAio: aio,
        neededFollowup: false,
        searches: 1,
        status,
        named,
        citedUrl: null,
        position: null,
        aioText: aio ? 'An overview.' : null,
        errorCode: status === 'error' ? 'timeout' : null,
        message: status === 'error' ? 'Search failed.' : null,
        nextStep: null,
        rawSearchJson: null,
        rawAioJson: null,
        references: []
      })
    })
    finishStoredRun(db, runId, '2026-10-20T12:01:30.000Z', 'finished')
  } finally {
    closeProjectDatabase(db)
  }
}

async function waitForJob(handlers: IpcHandlerMap, jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await handlers['checks:get']({ jobId })
    if (job !== null && job.status !== 'running') {
      expect(job.status).toBe('finished')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('The topic check did not finish')
}
