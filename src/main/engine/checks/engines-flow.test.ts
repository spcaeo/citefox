import type { EngineId } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { ProviderTimeoutError } from '../../providers/errors'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import { listStoredCheckRuns, listStoredCheckSteps } from '../../storage/check-records'
import {
  listEngineAnswers,
  listEngineSources,
  saveEngineSettings,
  savePageEngines
} from '../../storage/engine-records'
import { getPage } from '../../storage/pages'
import { closeSeeds, envelope, NOW, runFilter, SECRET, seed } from './checks.test-helper'
import {
  addCloroKey,
  bearerOf,
  citingAnswer,
  CLORO_SECRET,
  cloroEngineOf,
  cloroFixture,
  cloroResponse,
  jobSpend,
  OWN_URL,
  runRows,
  serpRowsRaw,
  shortAnswer,
  usageByKey
} from './engines.test-helper'

afterEach(() => {
  closeSeeds()
})

type Seeded = Awaited<ReturnType<typeof seed>>

/** cloro Lite: $30 for 37,500 credits, so one credit is 800 micro-dollars. */
const MICROS_PER_CLORO_CREDIT = 800
/** SerpApi Developer (the default plan): $75 for 5,000 searches. */
const MICROS_PER_SERPAPI_SEARCH = 15_000

interface Recorder {
  cloro: EngineId[]
  serpapi: string[]
  http: (request: HttpRequest) => HttpResponse
}

/**
 * Routes each request to a stub: cloro by engine path (checking the Bearer key), SerpApi
 * by its `engine` parameter (the recorded token + overview pair). Anything else fails.
 */
function recorder(
  cloro: Partial<Record<EngineId, (request: HttpRequest, attempt: number) => HttpResponse>>
): Recorder {
  const calls: Recorder = { cloro: [], serpapi: [], http: () => ({ status: 500, body: '' }) }
  calls.http = (request) => {
    const engine = cloroEngineOf(request)
    if (engine !== null) {
      expect(bearerOf(request)?.startsWith(CLORO_SECRET)).toBe(true)
      calls.cloro.push(engine)
      const respond = cloro[engine]
      if (respond === undefined) throw new Error(`unexpected cloro call: ${engine}`)
      return respond(request, calls.cloro.filter((item) => item === engine).length)
    }
    const url = new URL(request.url)
    expect(url.searchParams.get('api_key')).toBe(SECRET)
    const serpEngine = url.searchParams.get('engine') ?? ''
    calls.serpapi.push(serpEngine)
    return serpEngine === 'google_ai_overview'
      ? envelope('google-ai-overview.json')
      : envelope('google-page-token.json')
  }
  return calls
}

function start(
  seeded: Seeded,
  pageIds: readonly [string, ...string[]] = ['page-1']
): ReturnType<Seeded['handlers']['checks:start']> {
  return seeded.handlers['checks:start']({
    projectId: 'proj-1',
    pageIds,
    marketIds: null,
    promptIds: null
  })
}

async function seedWith(calls: Recorder, extra: { secondPage?: boolean } = {}): Promise<Seeded> {
  return seed({
    progress: [],
    sleep: async () => undefined,
    http: (request) => calls.http(request),
    ...extra
  })
}

function analysisStates(seeded: Seeded, jobId: string): string[] {
  return listStoredCheckSteps(seeded.projectDb, jobId)
    .filter((step) => step.phase === 'analysis')
    .map((step) => step.state)
}

describe('multi-engine checks through cloro', () => {
  test('Google via cloro, a cited ChatGPT answer and an unavailable Perplexity in one run', async () => {
    const calls = recorder({
      google_aio: () => cloroResponse(cloroFixture('google-overview.json'), 9),
      chatgpt: () => cloroResponse(citingAnswer(), 5),
      perplexity: () => cloroResponse(cloroFixture('perplexity-unavailable.json'), 0, 503)
    })
    const seeded = await seedWith(calls)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    saveEngineSettings(seeded.projectDb, { engines: ['google_aio', 'chatgpt', 'perplexity'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(job.engines).toEqual(['google_aio', 'chatgpt', 'perplexity'])
    expect(job.provider).toBe('cloro')
    // One HTTP attempt each: MODEL_UNAVAILABLE is not tried again, and SerpApi is not used.
    expect(calls.cloro).toEqual(['google_aio', 'chatgpt', 'perplexity'])
    expect(calls.serpapi).toEqual([])
    expect(job.searchesUsed).toBe(3)

    const [run, ...otherRuns] = runRows(seeded.projectDb)
    expect(otherRuns).toEqual([])
    expect(run).toMatchObject({
      engines: ['google_aio', 'chatgpt', 'perplexity'],
      googleAio: 1,
      status: 'finished'
    })

    expect(serpRowsRaw(seeded.projectDb)).toEqual([
      expect.objectContaining({
        runId: run?.id,
        provider: 'cloro',
        keyId: 'cloro-1',
        hasAio: 1,
        searches: 1,
        credits: 9,
        costMicros: 9 * MICROS_PER_CLORO_CREDIT,
        aioMarkdown: expect.any(String)
      })
    ])

    const answers = listEngineAnswers(seeded.projectDb, [run?.id ?? ''])
    expect(answers.map((answer) => answer.engine)).toEqual(['chatgpt', 'perplexity'])
    const [chatgpt, perplexity] = answers
    expect(chatgpt).toMatchObject({
      status: 'cited',
      citedUrl: OWN_URL,
      keyId: 'cloro-1',
      searches: 1,
      credits: 5,
      costMicros: 5 * MICROS_PER_CLORO_CREDIT,
      errorCode: null
    })
    expect(chatgpt?.answerText).toContain('AT&T')
    const sources = listEngineSources(seeded.projectDb, [chatgpt?.id ?? ''])
    expect(sources).toHaveLength(5)
    expect(sources.map((source) => source.position)).toEqual([1, 2, 3, 4, 5])
    expect(sources.find((source) => source.url === OWN_URL)).toMatchObject({
      position: 3,
      domain: 'textbolt.com',
      classification: 'target'
    })
    expect(perplexity).toMatchObject({
      status: 'unavailable',
      searches: 1,
      credits: 0,
      costMicros: 0,
      citedUrl: null
    })
    expect(perplexity?.message).toContain('Perplexity')
    expect(listEngineSources(seeded.projectDb, [perplexity?.id ?? ''])).toEqual([])

    const totalCredits = 9 + 5
    const totalMicros = totalCredits * MICROS_PER_CLORO_CREDIT
    expect(job.creditsUsed).toBe(totalCredits)
    expect(job.costMicros).toBe(totalMicros)
    expect(jobSpend(seeded.projectDb, job.id)).toEqual({
      status: 'finished',
      provider: 'cloro',
      creditsUsed: totalCredits,
      costMicros: totalMicros
    })
    // Every cloro attempt counts as a search; the SerpApi key is untouched.
    expect(usageByKey(seeded.storage)).toEqual({
      'cloro-1': { searches: 3, credits: totalCredits }
    })
  })

  test('no overview is "no_aio" and a short canned reply is "no_answer", not an error', async () => {
    const calls = recorder({
      google_aio: () => cloroResponse(cloroFixture('google-no-overview.json'), 7),
      chatgpt: () => cloroResponse(shortAnswer(), 7)
    })
    const seeded = await seedWith(calls)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    saveEngineSettings(seeded.projectDb, { engines: ['google_aio', 'chatgpt'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(serpRowsRaw(seeded.projectDb)).toEqual([
      expect.objectContaining({ provider: 'cloro', status: 'no_aio', hasAio: 0, credits: 7 })
    ])
    const [answer, ...rest] = listEngineAnswers(seeded.projectDb, [job.runIds[0] ?? ''])
    expect(rest).toEqual([])
    expect(answer).toMatchObject({
      engine: 'chatgpt',
      status: 'no_answer',
      errorCode: null,
      credits: 7,
      answerText: 'I cannot help with that.'
    })
    expect(analysisStates(seeded, job.id)).toEqual(['ok'])
  })

  test('a SerpApi-only project runs Google as before and skips ChatGPT without failing', async () => {
    const calls = recorder({})
    const seeded = await seedWith(calls)
    saveEngineSettings(seeded.projectDb, { engines: ['google_aio', 'chatgpt'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(job.provider).toBe('serpapi')
    expect(job.engines).toEqual(['google_aio'])
    expect(calls.cloro).toEqual([])
    expect(calls.serpapi).toEqual(['google', 'google_ai_overview'])
    const [run] = runRows(seeded.projectDb)
    expect(run).toMatchObject({ engines: ['google_aio'], googleAio: 1, status: 'finished' })
    expect(listEngineAnswers(seeded.projectDb, [run?.id ?? ''])).toEqual([])
    expect(serpRowsRaw(seeded.projectDb)).toEqual([
      expect.objectContaining({
        provider: 'serpapi',
        keyId: 'key-1',
        status: 'page_cited',
        searches: 2,
        credits: 0,
        costMicros: 2 * MICROS_PER_SERPAPI_SEARCH,
        aioMarkdown: null
      })
    ])
    expect(jobSpend(seeded.projectDb, job.id)).toMatchObject({
      provider: 'serpapi',
      creditsUsed: 0,
      costMicros: 2 * MICROS_PER_SERPAPI_SEARCH
    })
  })

  test('answer engines alone with no cloro key fail with "Add a cloro key" before any call', async () => {
    const calls = recorder({})
    const seeded = await seedWith(calls)
    saveEngineSettings(seeded.projectDb, { engines: ['chatgpt'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('error')
    expect(job.message).toBe('Add a cloro key to check these engines.')
    expect(job.nextStep).toBe('Open Connections and add a cloro key.')
    expect(calls.cloro).toEqual([])
    expect(calls.serpapi).toEqual([])
    expect(runRows(seeded.projectDb)).toEqual([])
    expect(jobSpend(seeded.projectDb, job.id)?.status).toBe('error')
  })

  test('provider "serpapi" with both keys: Google via SerpApi, ChatGPT via cloro', async () => {
    const calls = recorder({ chatgpt: () => cloroResponse(citingAnswer(), 5) })
    const seeded = await seedWith(calls)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    saveEngineSettings(
      seeded.projectDb,
      { engines: ['google_aio', 'chatgpt'], provider: 'serpapi' },
      NOW
    )

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(job.provider).toBe('serpapi')
    expect(calls.serpapi).toEqual(['google', 'google_ai_overview'])
    expect(calls.cloro).toEqual(['chatgpt'])
    expect(serpRowsRaw(seeded.projectDb)).toEqual([
      expect.objectContaining({ provider: 'serpapi', keyId: 'key-1', searches: 2, credits: 0 })
    ])
    const [answer] = listEngineAnswers(seeded.projectDb, [job.runIds[0] ?? ''])
    expect(answer).toMatchObject({ engine: 'chatgpt', status: 'cited', keyId: 'cloro-1' })
    expect(usageByKey(seeded.storage)).toEqual({
      'cloro-1': { searches: 1, credits: 5 },
      'key-1': { searches: 2, credits: 0 }
    })
    expect(jobSpend(seeded.projectDb, job.id)).toMatchObject({
      provider: 'serpapi',
      creditsUsed: 5,
      costMicros: 2 * MICROS_PER_SERPAPI_SEARCH + 5 * MICROS_PER_CLORO_CREDIT
    })
    expect(job.searchesUsed).toBe(3)
  })
})

describe('answer-engine runs leave Google numbers alone', () => {
  test('a ChatGPT-only run stores google_aio = 0 and Google views stay empty', async () => {
    const calls = recorder({ chatgpt: () => cloroResponse(citingAnswer(), 5) })
    const seeded = await seedWith(calls)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    saveEngineSettings(seeded.projectDb, { engines: ['chatgpt'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(job.provider).toBeNull()
    expect(calls.cloro).toEqual(['chatgpt'])
    const [run] = runRows(seeded.projectDb)
    expect(run).toMatchObject({ engines: ['chatgpt'], googleAio: 0, status: 'finished' })
    expect(serpRowsRaw(seeded.projectDb)).toEqual([])
    expect(listStoredCheckRuns(seeded.projectDb, runFilter())).toEqual([])
    expect(listStoredCheckRuns(seeded.projectDb, { ...runFilter(), anyEngine: true })).toHaveLength(
      1
    )
    const results = await seeded.handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(results.run).toBeNull()
    const history = await seeded.handlers['results:history']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null
    })
    expect(history.points).toEqual([])
  })

  test('a ChatGPT-only run after a Google run does not move Google results or the score', async () => {
    const calls = recorder({
      google_aio: () =>
        cloroResponse(
          cloroFixture('google-overview.json', {
            'https://www.txtimpact.com/blog/att-email-to-text-alternative': OWN_URL
          }),
          7
        ),
      chatgpt: () => cloroResponse(shortAnswer(), 7)
    })
    const seeded = await seedWith(calls)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    const resultsRequest = {
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    } as const

    const google = await start(seeded)
    expect(google.status).toBe('finished')
    const before = await seeded.handlers['results:get'](resultsRequest)
    const historyBefore = await seeded.handlers['results:history']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null
    })
    const scoreBefore = getPage(seeded.projectDb, 'page-1', 'proj-1')?.score
    expect(before.run?.runId).toBe(google.runIds[0])
    expect(before.run?.pageCited).toBe(1)
    expect(scoreBefore).toBe(before.run?.visibilityScore)

    saveEngineSettings(seeded.projectDb, { engines: ['chatgpt'] }, NOW)
    const answersOnly = await start(seeded)

    expect(answersOnly.status).toBe('finished')
    expect(calls.cloro).toEqual(['google_aio', 'chatgpt'])
    expect(runRows(seeded.projectDb).map((run) => run.googleAio)).toEqual([1, 0])
    expect(serpRowsRaw(seeded.projectDb)).toHaveLength(1)
    const googleRuns = listStoredCheckRuns(seeded.projectDb, runFilter())
    expect(googleRuns.map((run) => run.id)).toEqual([before.run?.runId])
    const after = await seeded.handlers['results:get'](resultsRequest)
    expect(after.run?.runId).toBe(before.run?.runId)
    expect(after.run?.visibilityScore).toBe(before.run?.visibilityScore)
    expect(after.prompts.map((prompt) => prompt.status)).toEqual(
      before.prompts.map((prompt) => prompt.status)
    )
    const historyAfter = await seeded.handlers['results:history']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null
    })
    expect(historyAfter.points).toEqual(historyBefore.points)
    expect(getPage(seeded.projectDb, 'page-1', 'proj-1')?.score).toBe(scoreBefore)
  })
})

describe('cloro retries and per-page engines', () => {
  test('a timed-out answer call is never retried and is stored as an error', async () => {
    const calls = recorder({
      google_aio: () => cloroResponse(cloroFixture('google-overview.json'), 7),
      chatgpt: () => {
        throw new ProviderTimeoutError('cloro call', 300_000)
      }
    })
    const seeded = await seedWith(calls)
    // A second key: a timeout must not move to it either (the call may still be billed).
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets, 'cloro-2', 2)
    saveEngineSettings(seeded.projectDb, { engines: ['google_aio', 'chatgpt'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(calls.cloro.filter((engine) => engine === 'chatgpt')).toHaveLength(1)
    const [answer] = listEngineAnswers(seeded.projectDb, [job.runIds[0] ?? ''])
    expect(answer).toMatchObject({
      engine: 'chatgpt',
      status: 'error',
      errorCode: 'timeout',
      searches: 1,
      credits: 0,
      costMicros: 0
    })
    expect(answer?.message).toContain('timed out')
    expect(analysisStates(seeded, job.id)).toEqual(['warning'])
    const usage = usageByKey(seeded.storage)
    const searches = Object.values(usage).reduce((sum, row) => sum + row.searches, 0)
    expect(searches).toBe(2)
    expect(job.searchesUsed).toBe(2)
  })

  test('a 503 on an answer call is retried once and both attempts count as searches', async () => {
    const calls = recorder({
      chatgpt: (_request, attempt) =>
        attempt === 1
          ? cloroResponse(JSON.stringify({ success: false }), null, 503)
          : cloroResponse(citingAnswer(), 5)
    })
    const seeded = await seedWith(calls)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    saveEngineSettings(seeded.projectDb, { engines: ['chatgpt'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(calls.cloro).toEqual(['chatgpt', 'chatgpt'])
    const [answer] = listEngineAnswers(seeded.projectDb, [job.runIds[0] ?? ''])
    expect(answer).toMatchObject({ status: 'cited', searches: 2, credits: 5 })
    expect(usageByKey(seeded.storage)).toEqual({ 'cloro-1': { searches: 2, credits: 5 } })
    expect(job.searchesUsed).toBe(2)
  })

  test('a cloro key cloro rejects moves the answer call to the next cloro key', async () => {
    const keys: (string | null)[] = []
    const calls = recorder({
      chatgpt: (request) => {
        keys.push(bearerOf(request))
        return bearerOf(request) === CLORO_SECRET
          ? cloroResponse(
              JSON.stringify({ success: false, error: { code: 'INVALID_API_KEY', message: '' } }),
              null,
              401
            )
          : cloroResponse(citingAnswer(), 5)
      }
    })
    const seeded = await seedWith(calls)
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    const second = addCloroKey(seeded.storage, seeded.checkDeps.secrets, 'cloro-2', 2)
    saveEngineSettings(seeded.projectDb, { engines: ['chatgpt'] }, NOW)

    const job = await start(seeded)

    expect(job.status).toBe('finished')
    expect(keys).toEqual([CLORO_SECRET, second])
    const [answer] = listEngineAnswers(seeded.projectDb, [job.runIds[0] ?? ''])
    expect(answer).toMatchObject({ status: 'cited', keyId: 'cloro-2', searches: 2, credits: 5 })
    expect(usageByKey(seeded.storage)).toEqual({
      'cloro-1': { searches: 1, credits: 0 },
      'cloro-2': { searches: 1, credits: 5 }
    })
  })

  test("a page's own engines override the project's: only Gemini is checked there", async () => {
    const calls = recorder({
      google_aio: () => cloroResponse(cloroFixture('google-overview.json'), 7),
      gemini: () => cloroResponse(citingAnswer(), 6)
    })
    const seeded = await seedWith(calls, { secondPage: true })
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    // The project keeps the default (Google AI Overview); page-1 picks Gemini alone.
    savePageEngines(seeded.projectDb, 'page-1', ['gemini'], NOW)

    const job = await start(seeded, ['page-1', 'page-2'])

    expect(job.status).toBe('finished')
    expect(job.engines).toEqual(['google_aio', 'gemini'])
    expect(calls.cloro).toEqual(['gemini', 'google_aio'])
    const runs = runRows(seeded.projectDb)
    const byPage = new Map(
      listStoredCheckRuns(seeded.projectDb, {
        ...runFilter(),
        pageIds: ['page-1', 'page-2'],
        anyEngine: true
      }).map((run) => [run.pageId, run.id])
    )
    const pageOneRun = runs.find((run) => run.id === byPage.get('page-1'))
    const pageTwoRun = runs.find((run) => run.id === byPage.get('page-2'))
    expect(pageOneRun).toMatchObject({ engines: ['gemini'], googleAio: 0 })
    expect(pageTwoRun).toMatchObject({ engines: ['google_aio'], googleAio: 1 })
    expect(serpRowsRaw(seeded.projectDb).map((row) => row.runId)).toEqual([pageTwoRun?.id])
    const answers = listEngineAnswers(seeded.projectDb, [
      pageOneRun?.id ?? '',
      pageTwoRun?.id ?? ''
    ])
    expect(answers).toEqual([
      expect.objectContaining({
        runId: pageOneRun?.id,
        engine: 'gemini',
        status: 'cited',
        credits: 6
      })
    ])
  })
})
