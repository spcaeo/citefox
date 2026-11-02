import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CheckJob, CheckProgress, ResultsChanged } from '@shared/ipc'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import { listStoredSerpResults } from '../../storage/check-records'
import {
  listEngineAnswers,
  saveEngineSettings,
  savePageEngines
} from '../../storage/engine-records'
import { writeProjectScheduleCap } from '../../storage/project-schedule'
import { addKeyUsage } from '../../storage/records'
import { monthKey } from '../../scheduler/local-time'
import { CHECK_QUESTIONS_AT_ONCE, PROVIDER_CALLS_AT_ONCE } from './check-pace'
import { closeSeeds, envelope, NOW, runFilter, seed, timeZone } from './checks.test-helper'
import { resumeInterruptedChecks } from './engine'
import {
  addCloroKey,
  citingAnswer,
  cloroEngineOf,
  cloroFixture,
  cloroResponse
} from './engines.test-helper'

afterEach(() => {
  vi.useRealTimers()
  closeSeeds()
})

type Seeded = Awaited<ReturnType<typeof seed>>

const QUESTIONS = Array.from(
  { length: 7 },
  (_, index) => `How do I text crew number ${index + 1} about a shift change?`
)

/**
 * Faster checks (owner, 2026-10-29: 12 questions took over ten minutes, one after
 * another). Questions now run three at once and each question's engines side by side;
 * these prove the pool's bounds, Stop, the cap, resume and a stable result order.
 */

/** A SerpApi stub that holds each call a few ms and counts how many overlap. */
function overlapHttp(
  onStart?: (q: string) => void,
  respond: (request: HttpRequest) => HttpResponse = () => envelope('google-no-aio.json')
): {
  http: (request: HttpRequest) => Promise<HttpResponse>
  log: string[]
  most: () => number
  open: () => number
} {
  const log: string[] = []
  let inFlight = 0
  let most = 0
  return {
    log,
    most: () => most,
    open: () => inFlight,
    async http(request) {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      inFlight += 1
      most = Math.max(most, inFlight)
      log.push(`start:${q}`)
      onStart?.(q)
      await new Promise((resolve) => setTimeout(resolve, 5))
      log.push(`end:${q}`)
      inFlight -= 1
      return respond(request)
    }
  }
}

async function startTopic(
  seeded: Seeded,
  questions: readonly string[],
  topic?: { id: string }
): Promise<string> {
  const base = { projectId: 'proj-1' }
  const draft = await seeded.handlers['topics:createDraft']({
    ...base,
    path: 'questions',
    name: 'Crew'
  })
  await seeded.handlers['topics:importQuestions']({
    ...base,
    draftId: draft.id,
    text: questions.join('\n')
  })
  const started = await seeded.handlers['topics:start']({
    ...base,
    draftId: draft.id,
    plan: 'all_now'
  })
  if (topic !== undefined) topic.id = started.topicId
  return started.jobId ?? ''
}

async function waitForJob(seeded: Seeded, jobId: string): Promise<CheckJob | null> {
  let job = await seeded.handlers['checks:get']({ jobId })
  for (let attempt = 0; attempt < 600 && (job === null || job.status === 'running'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    job = await seeded.handlers['checks:get']({ jobId })
  }
  return job
}

/** Every stored Google sample of the project, whichever page or topic it belongs to. */
function samples(seeded: Seeded): { promptId: string }[] {
  return seeded.projectDb
    .prepare<unknown[], { promptId: string }>('SELECT prompt_id AS promptId FROM serp_results')
    .all()
}

function queries(log: readonly string[], kind: 'start' | 'end'): string[] {
  return log
    .filter((line) => line.startsWith(`${kind}:`))
    .map((line) => line.slice(kind.length + 1))
}

describe('a check runs questions side by side', () => {
  test('the first search goes alone, then three at once; results stay in question order', async () => {
    const progress: CheckProgress[] = []
    const changed: ResultsChanged[] = []
    const stub = overlapHttp()
    const seeded = await seed({ progress, changed, http: stub.http })
    const topicRef = { id: '' }
    const job = await waitForJob(seeded, await startTopic(seeded, QUESTIONS, topicRef))

    expect(job).toMatchObject({ status: 'finished', done: 7, total: 7, searchesUsed: 7 })
    // The job's first call finds out whether the key works before the others start.
    expect(stub.log.slice(0, 2)).toEqual([`start:${QUESTIONS[0]}`, `end:${QUESTIONS[0]}`])
    expect(stub.most()).toBe(CHECK_QUESTIONS_AT_ONCE)
    expect(queries(stub.log, 'start')).toEqual(QUESTIONS)
    // The check window was told how many run at once.
    expect(Math.max(...progress.map((event) => event.inFlight ?? 0))).toBe(3)
    // One live push per saved question, counting up, then the end.
    const running = changed.filter((event) => event.state === 'running')
    expect(running.map((event) => event.done)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(running.map((event) => event.promptId)).size).toBe(7)
    // Stored once per question, read back in question order.
    expect(samples(seeded)).toHaveLength(7)
    const topic = await seeded.handlers['topics:results']({
      projectId: 'proj-1',
      topicId: topicRef.id,
      marketId: null,
      runId: null
    })
    expect(topic.rows.map((row) => row.text)).toEqual(QUESTIONS)
    expect(topic.rows.every((row) => row.runId !== null)).toBe(true)
  })

  test('Stop starts no new search, and the job ends only when the running ones land', async () => {
    let seeded: Seeded | null = null
    let jobId = ''
    let cancelledAt: number | null = null
    const stub = overlapHttp((q) => {
      // Stop as the fifth question starts: questions 3 to 5 are in flight.
      if (q === QUESTIONS[4] && seeded !== null && cancelledAt === null) {
        cancelledAt = queries(stub.log, 'start').length
        void seeded.handlers['checks:cancel']({ jobId })
      }
    })
    seeded = await seed({ progress: [], http: stub.http })
    jobId = await startTopic(seeded, QUESTIONS)
    const job = await waitForJob(seeded, jobId)

    expect(job?.status).toBe('cancelled')
    expect(cancelledAt).toBe(5)
    // Nothing started after Stop; everything that started had landed when the job ended.
    expect(queries(stub.log, 'start')).toEqual(QUESTIONS.slice(0, 5))
    expect(queries(stub.log, 'end')).toHaveLength(5)
    expect(stub.open()).toBe(0)
    // Every search that landed is kept and counted (none is lost to the Stop).
    expect(samples(seeded)).toHaveLength(5)
    expect(job?.done).toBe(5)
    expect(job?.searchesUsed).toBe(5)
  })

  test('the project cap stops the job mid-run without passing it', async () => {
    let seeded: Seeded | null = null
    // Another check of the project spends 10 searches while this one runs (one shared cap).
    const stub = overlapHttp((q) => {
      if (q !== QUESTIONS[2] || seeded === null) return
      addKeyUsage(seeded.storage.db, {
        id: 'usage-elsewhere',
        keyId: 'key-1',
        projectId: 'proj-1',
        month: monthKey(Date.parse(NOW), timeZone()),
        searches: 10,
        calls: 10,
        tokens: 0
      })
    })
    seeded = await seed({ progress: [], http: stub.http })
    writeProjectScheduleCap(seeded.projectDb, { cap: 14, capRule: 'pause', dedicatedKeyId: null })
    const job = await waitForJob(seeded, await startTopic(seeded, QUESTIONS))

    expect(job).toMatchObject({
      status: 'error',
      message: "This check would pass the project's search cap."
    })
    // Calls admitted at once never pass the cap together: 10 + this job's ≤ 14.
    const calls = queries(stub.log, 'start').length
    expect(calls).toBeLessThan(QUESTIONS.length)
    expect(10 + calls).toBeLessThanOrEqual(14)
    expect(stub.open()).toBe(0)
    // Every search that landed is kept and counted.
    expect(job?.searchesUsed).toBe(calls)
    expect(samples(seeded)).toHaveLength(calls)
    expect(job?.done).toBe(calls)
  })

  test('a resume after a quit searches only the questions not yet stored', async () => {
    let seeded: Seeded | null = null
    let jobId = ''
    const stub = overlapHttp((q) => {
      if (q === QUESTIONS[3] && seeded !== null) void seeded.handlers['checks:cancel']({ jobId })
    })
    seeded = await seed({ progress: [], http: stub.http })
    jobId = await startTopic(seeded, QUESTIONS)
    const stopped = await waitForJob(seeded, jobId)
    expect(stopped?.status).toBe('cancelled')
    const before = queries(stub.log, 'start')
    expect(before).toEqual(QUESTIONS.slice(0, 4))
    // As if the app quit mid-check: the job and its run are still "running".
    seeded.projectDb
      .prepare("UPDATE check_jobs SET status = 'running', finished_at = NULL WHERE id = ?")
      .run(jobId)
    seeded.projectDb.prepare("UPDATE runs SET status = 'running', finished_at = NULL").run()

    const [resumed] = await resumeInterruptedChecks(seeded.checkEngine)
    expect(resumed).toMatchObject({ id: jobId, status: 'finished', done: 7 })
    const after = queries(stub.log, 'start').slice(before.length)
    expect(after).toEqual(QUESTIONS.slice(4))
    const rows = samples(seeded)
    expect(rows).toHaveLength(7)
    expect(new Set(rows.map((row) => row.promptId)).size).toBe(7)
  })

  test("one question's Google search and answer engines run side by side", async () => {
    const open = new Map<string, number>()
    let inFlight = 0
    let most = 0
    const seeded = await seed({
      progress: [],
      secondPrompt: true,
      sleep: async () => undefined,
      async http(request) {
        const engine = cloroEngineOf(request)
        if (engine === null) throw new Error('only cloro is expected')
        inFlight += 1
        most = Math.max(most, inFlight)
        open.set(engine, (open.get(engine) ?? 0) + 1)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        if (engine === 'google_aio') return cloroResponse(cloroFixture('google-overview.json'), 9)
        if (engine === 'chatgpt') return cloroResponse(citingAnswer(), 5)
        return cloroResponse(cloroFixture('perplexity-unavailable.json'), 0, 503)
      }
    })
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    savePageEngines(seeded.projectDb, 'page-1', ['google_aio', 'chatgpt', 'perplexity'], NOW)
    const job = await seeded.handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    expect(job.done).toBe(2)
    // After the first call: both questions' Google and engines together (2 × 3 − 1 = 5
    // wanted), held to the provider's limit.
    expect(most).toBe(PROVIDER_CALLS_AT_ONCE)
    const answers = listEngineAnswers(seeded.projectDb, job.runIds)
    expect(answers.map((answer) => [answer.promptId, answer.engine, answer.status])).toEqual([
      ['prompt-1', 'chatgpt', 'cited'],
      ['prompt-1', 'perplexity', 'unavailable'],
      ['prompt-2', 'chatgpt', 'cited'],
      ['prompt-2', 'perplexity', 'unavailable']
    ])
    expect(listStoredSerpResults(seeded.projectDb, runFilter())).toHaveLength(2)
  })

  test('the AI Overview shows (and celebrates) before the slower ChatGPT answer lands', async () => {
    const changed: ResultsChanged[] = []
    const answerAt: number[] = []
    let releaseChatgpt: () => void = () => undefined
    const chatgptHeld = new Promise<void>((resolve) => {
      releaseChatgpt = resolve
    })
    const seeded = await seed({
      progress: [],
      changed,
      sleep: async () => undefined,
      async http(request) {
        if (cloroEngineOf(request) === 'google_aio') {
          return cloroResponse(cloroFixture('google-overview.json'), 9)
        }
        await chatgptHeld
        answerAt.push(changed.length)
        return cloroResponse(citingAnswer(), 5)
      }
    })
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    savePageEngines(seeded.projectDb, 'page-1', ['google_aio', 'chatgpt'], NOW)
    const pending = seeded.handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    for (let turn = 0; turn < 50 && changed.length === 0; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    // ChatGPT is still out: the overview is pushed with its citation, not yet scored.
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ promptId: 'prompt-1', state: 'running', done: 0 })
    expect(changed[0]?.citation).toMatchObject({ kind: 'cited', firstEver: true })
    expect(samples(seeded)).toHaveLength(1)
    releaseChatgpt()
    const job = await pending
    expect(job.status).toBe('finished')
    expect(answerAt).toEqual([1])
    // Scored once ChatGPT is in; the citation is not celebrated a second time.
    expect(changed.map((event) => [event.state, event.done, event.citation ?? null])).toEqual([
      ['running', 0, expect.objectContaining({ kind: 'cited' })],
      ['running', 1, null],
      ['finished', 1, null]
    ])
  })
})

/**
 * The owner's first check, replayed on a fake clock: 12 questions, the Google AI Overview
 * 20 s and ChatGPT (through cloro) 40 s each, as measured. One after another that is
 * 12 × 60 s = 12 minutes.
 */
describe('time for the owner’s 12-question check', () => {
  async function simulate(
    engines: ('google_aio' | 'chatgpt')[]
  ): Promise<{ seconds: number; calls: Record<string, number> }> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const calls: Record<string, number> = {}
    const seeded = await seed({
      progress: [],
      sleep: async () => undefined,
      async http(request) {
        const engine = cloroEngineOf(request) ?? 'other'
        calls[engine] = (calls[engine] ?? 0) + 1
        const seconds = engine === 'google_aio' ? 20 : 40
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        return engine === 'google_aio'
          ? cloroResponse(cloroFixture('google-overview.json'), 9)
          : cloroResponse(citingAnswer(), 5)
      }
    })
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    saveEngineSettings(seeded.projectDb, { engines }, NOW)
    const twelve = Array.from({ length: 12 }, (_, index) => `best text alert tool option ${index}`)
    const startedAt = Date.now()
    const jobId = await startTopic(seeded, twelve)
    let job = await seeded.handlers['checks:get']({ jobId })
    for (let tick = 0; tick < 2000 && job?.status === 'running'; tick += 1) {
      await vi.advanceTimersByTimeAsync(1000)
      for (let turn = 0; turn < 3; turn += 1) await new Promise((r) => setImmediate(r))
      job = await seeded.handlers['checks:get']({ jobId })
    }
    expect(job).toMatchObject({ status: 'finished', done: 12 })
    return { seconds: Math.round((Date.now() - startedAt) / 1000), calls }
  }

  test('Google and a second engine: under 4 minutes instead of 12', async () => {
    const { seconds, calls } = await simulate(['google_aio', 'chatgpt'])
    expect(calls).toEqual({ google_aio: 12, chatgpt: 12 })
    // One after another: 12 × (20 + 40) = 720 s. Now: 720 call-seconds over
    // PROVIDER_CALLS_AT_ONCE (4) cloro calls at once is 180 s at best, plus the first
    // call alone and the gaps while the three questions refill.
    expect(PROVIDER_CALLS_AT_ONCE).toBe(4)
    expect(seconds).toBeGreaterThanOrEqual(180)
    expect(seconds).toBeLessThanOrEqual(230)
  })

  test('Google alone: under 2 minutes instead of 4', async () => {
    const { seconds, calls } = await simulate(['google_aio'])
    expect(calls).toEqual({ google_aio: 12 })
    // One after another: 12 × 20 = 240 s. Now: the first alone, then 11 three at a time.
    expect(seconds).toBeGreaterThanOrEqual(95)
    expect(seconds).toBeLessThanOrEqual(110)
  })
})
