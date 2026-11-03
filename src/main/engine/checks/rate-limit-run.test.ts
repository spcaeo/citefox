import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CheckProgress } from '@shared/ipc'
import { CHECK_SLOWED_NOTICE } from '@shared/domain'
import { RATE_LIMITED_MESSAGE } from '../../providers/cloro/api'
import type { HttpResponse } from '../../providers/http'
import { saveEngineSettings } from '../../storage/engine-records'
import { listApiKeys } from '../../storage/records'
import { captureCloroAnswer, type CloroCaptureOptions } from './cloro-capture'
import { closeSeeds, NOW, seed } from './checks.test-helper'
import {
  addCloroKey,
  citingAnswer,
  cloroEngineOf,
  cloroFixture,
  cloroResponse
} from './engines.test-helper'
import { createCallPacer, PACING, setProviderPacer } from './provider-pacer'

afterEach(() => {
  vi.useRealTimers()
  closeSeeds()
})

/**
 * Real testers on a free cloro plan: about 106 requests, 6 answered, the rest HTTP 429,
 * 13 of them inside two seconds. These replay that on a fake clock.
 */

const RATE_LIMITED: HttpResponse = {
  status: 429,
  body: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'slow down' } })
}

describe('13 calls in one second on a plan that takes one at a time', () => {
  function replay(pacing: { initialLimit: number; minGapMs: number }): {
    outcomes: Promise<Awaited<ReturnType<typeof captureCloroAnswer>>[]>
    accepted: number[]
    refused: number[]
    starts: number[]
  } {
    let clock = Date.parse('2026-11-03T15:16:54Z')
    const sleep = async (ms: number): Promise<void> => {
      clock += ms
    }
    const now = (): number => clock
    const pacer = createCallPacer(
      'cloro',
      { now, sleep, random: () => 0.5 },
      { ...PACING.cloro, ...pacing }
    )
    const accepted: number[] = []
    const refused: number[] = []
    const starts: number[] = []
    let lastAccepted = Number.NEGATIVE_INFINITY
    let busyUntil = Number.NEGATIVE_INFINITY
    const transport = {
      async request(): Promise<HttpResponse> {
        starts.push(clock)
        // The plan: one call a second. A call inside that second of the last good one is refused.
        if (clock - lastAccepted < 1000 || clock < busyUntil) {
          refused.push(clock)
          return RATE_LIMITED
        }
        lastAccepted = clock
        accepted.push(clock)
        busyUntil = clock + 1000
        return {
          status: 200,
          body: cloroFixture('chatgpt.json'),
          headers: { 'x-credits-charged': '7' }
        }
      }
    }
    const options = (): CloroCaptureOptions => ({
      transport,
      secret: 'cloro-test-key-0000',
      query: { q: 'q', gl: 'in', hl: 'en', location: null, device: 'desktop' },
      sleep,
      now,
      pacer
    })
    const outcomes = Promise.all(
      Array.from({ length: 13 }, () =>
        pacer.limiter.run(() => captureCloroAnswer('chatgpt', options()))
      )
    )
    return { outcomes, accepted, refused, starts }
  }

  test('with the careful start, nothing is refused and all 13 are answered', async () => {
    const run = replay(PACING.cloro)
    const results = await run.outcomes
    expect(results.every((result) => result.outcome === 'answer')).toBe(true)
    expect(run.refused).toHaveLength(0)
    expect(run.accepted).toHaveLength(13)
    // Never two call starts inside the same second.
    const sorted = [...run.starts].sort((left, right) => left - right)
    for (let index = 1; index < sorted.length; index += 1) {
      expect((sorted[index] ?? 0) - (sorted[index - 1] ?? 0)).toBeGreaterThanOrEqual(1000)
    }
  })

  test('with the old burst (4 at once, no gap) the refusals only slow it down: 13 answered, none failed', async () => {
    const run = replay({ initialLimit: 4, minGapMs: 0 })
    const results = await run.outcomes
    expect(run.refused.length).toBeGreaterThan(0)
    expect(results.filter((result) => result.outcome === 'error')).toHaveLength(0)
    expect(run.accepted).toHaveLength(13)
    // A refused call is not billed and not counted as a search again.
    expect(results.every((result) => result.searches === 1)).toBe(true)
  })
})

describe('a whole check on a plan that allows one call at a time', () => {
  test('28 calls finish with zero failed questions and no key marked bad', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let inFlight = 0
    let refused = 0
    let accepted = 0
    let largestBurst = 0
    const progress: CheckProgress[] = []
    const seeded = await seed({
      progress,
      sleep: async () => undefined,
      async http(request) {
        const engine = cloroEngineOf(request) ?? 'other'
        // The plan takes one call at a time; a second one meanwhile is refused.
        largestBurst = Math.max(largestBurst, inFlight + 1)
        if (inFlight >= 1) {
          refused += 1
          return RATE_LIMITED
        }
        inFlight += 1
        accepted += 1
        await new Promise((resolve) => setTimeout(resolve, 2000))
        inFlight -= 1
        return engine === 'google_aio'
          ? cloroResponse(cloroFixture('google-overview.json'), 9)
          : cloroResponse(citingAnswer(), 5)
      }
    })
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    // A new key on a free plan: the pace starts careful, on the fake clock.
    setProviderPacer(
      seeded.storage.db,
      'cloro',
      createCallPacer('cloro', { random: () => 0.5 }, PACING.cloro)
    )
    saveEngineSettings(seeded.projectDb, { engines: ['google_aio', 'chatgpt'] }, NOW)
    const questions = Array.from(
      { length: 14 },
      (_, index) => `best text alert tool option ${index}`
    )
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
    const jobId = started.jobId ?? ''
    let job = await seeded.handlers['checks:get']({ jobId })
    for (let tick = 0; tick < 4000 && job?.status === 'running'; tick += 1) {
      await vi.advanceTimersByTimeAsync(1000)
      for (let turn = 0; turn < 3; turn += 1) await new Promise((r) => setImmediate(r))
      job = await seeded.handlers['checks:get']({ jobId })
    }
    expect(job).toMatchObject({ status: 'finished', done: 14, total: 14 })
    expect(accepted).toBe(28)
    expect(job?.steps.filter((step) => step.state === 'error')).toHaveLength(0)
    expect(job?.steps.filter((step) => step.errorCode === 'rate_limited')).toHaveLength(0)
    // The refusals that did happen made the run slower, never the questions fail.
    expect(listApiKeys(seeded.storage.db).every((key) => key.state === 'ok')).toBe(true)
    expect(largestBurst).toBeGreaterThanOrEqual(1)
    if (refused > 0) {
      expect(progress.some((event) => event.slowedNotice === CHECK_SLOWED_NOTICE)).toBe(true)
    }
  })

  test('a plan that refuses everything ends the questions with the plain message, not a key problem', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const seeded = await seed({
      progress: [],
      sleep: async () => undefined,
      async http() {
        return RATE_LIMITED
      }
    })
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    setProviderPacer(
      seeded.storage.db,
      'cloro',
      createCallPacer('cloro', { random: () => 0.5 }, PACING.cloro)
    )
    saveEngineSettings(seeded.projectDb, { engines: ['google_aio'] }, NOW)
    const job0 = Promise.resolve(
      seeded.handlers['checks:start']({
        projectId: 'proj-1',
        pageIds: ['page-1'],
        marketIds: null,
        promptIds: null
      })
    )
    let settled = false
    void job0.then(() => {
      settled = true
    })
    for (let tick = 0; tick < 4000 && !settled; tick += 1) {
      await vi.advanceTimersByTimeAsync(1000)
      for (let turn = 0; turn < 3; turn += 1) await new Promise((r) => setImmediate(r))
    }
    const job = await job0
    const failed = job.steps.filter((step) => step.state === 'error')
    expect(failed.length).toBeGreaterThan(0)
    expect(failed.every((step) => step.error === RATE_LIMITED_MESSAGE)).toBe(true)
    expect(failed.every((step) => step.errorCode === 'rate_limited')).toBe(true)
    // No "Open Connections" step: this is about the plan, not the key.
    expect(progress0(job)).toBe(true)
    expect(listApiKeys(seeded.storage.db).every((key) => key.state === 'ok')).toBe(true)
  })
})

function progress0(job: { steps: readonly { error: string | null }[] }): boolean {
  return job.steps.every((step) => step.error === null || !/Connections|cloro/i.test(step.error))
}
