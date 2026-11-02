import { afterEach, describe, expect, test } from 'vitest'
import { ENGINE_IDS, type EngineId } from '@shared/domain'
import { addKeyUsage } from '../storage/records'
import {
  addAnswer,
  addBrandCapture,
  addBrandPrompts,
  addEmptyJob,
  addGoogle,
  addRun,
  callRaw as call,
  cleanupEngineSeeds,
  finishedAt,
  finishJob,
  MICROS_PER_LITE_CREDIT,
  openEngineSeed,
  PAGE_URL,
  PROGRESS_SEED,
  replacePromptSet,
  source,
  withDb
} from './engines.test-helper'

/** `engines:question`, `engines:summary` and `engines:spend` over results written to storage. */

afterEach(() => {
  cleanupEngineSeeds()
})

const P = PROGRESS_SEED
const [ONE, TWO, THREE] = P.prompts
const base = { projectId: P.projectId }
const page = { ...base, pageId: P.pageId }

describe('engines:question', () => {
  const question = { ...page, promptId: ONE.id }

  function seedAnswers(seed: ReturnType<typeof openEngineSeed>): void {
    withDb(seed, (db) => {
      // An older check: ChatGPT cited then, but the newer check is what shows.
      addRun(db, {
        id: 'r-old',
        startedAt: '2026-10-10T12:00:00.000Z',
        engines: ['google_aio', 'chatgpt']
      })
      addGoogle(db, 'r-old', ONE.id, 1, 'not_cited')
      addAnswer(db, 'r-old', ONE.id, 'chatgpt', 'cited', 1, {
        checkedAt: '2026-10-10T12:00:30.000Z'
      })

      addRun(db, {
        id: 'r-new',
        startedAt: '2026-10-20T12:00:00.000Z',
        engines: ['google_aio', 'chatgpt', 'perplexity']
      })
      addGoogle(db, 'r-new', ONE.id, 1, 'not_cited', {
        provider: 'cloro',
        credits: 7,
        costMicros: 5_600
      })
      addGoogle(db, 'r-new', ONE.id, 2, 'page_cited', {
        provider: 'cloro',
        credits: 7,
        costMicros: 5_600,
        citedUrl: PAGE_URL,
        position: 2,
        aioMarkdown: '**Overview** 2',
        references: [
          {
            ...source('ref-2', 2, 'textbolt.com', 'target'),
            url: PAGE_URL,
            normalizedUrl: PAGE_URL,
            untracked: false,
            sourceType: 'web'
          },
          { ...source('ref-1', 1, 'twilio.com', 'competitor'), untracked: false, sourceType: 'web' }
        ]
      })
      addGoogle(db, 'r-new', ONE.id, 3, 'brand_mentioned', {
        provider: 'cloro',
        credits: 7,
        costMicros: 5_600,
        named: true
      })
      // Another question in the same run is not this question's answer.
      addGoogle(db, 'r-new', TWO.id, 1, 'page_cited')
      addAnswer(db, 'r-new', ONE.id, 'chatgpt', 'named', 1, {
        sources: [
          source('cs-3', 3, 'reddit.com'),
          source('cs-1', 1, 'simpletexting.com', 'competitor'),
          source('cs-2', 2, 'twilio.com', 'competitor')
        ]
      })
      addAnswer(db, 'r-new', ONE.id, 'chatgpt', 'not_cited', 2, {
        sources: [source('cs-9', 1, 'example.com')]
      })
      addAnswer(db, 'r-new', ONE.id, 'perplexity', 'error', 1, { credits: 0, costMicros: 0 })
      addAnswer(db, 'r-new', ONE.id, 'perplexity', 'no_answer', 2)

      // A cancelled and an unfinished check later on are ignored.
      addRun(db, {
        id: 'r-cancel',
        startedAt: '2026-10-21T12:00:00.000Z',
        engines: ['google_aio', 'chatgpt'],
        status: 'cancelled'
      })
      addGoogle(db, 'r-cancel', ONE.id, 1, 'error')
      addAnswer(db, 'r-cancel', ONE.id, 'chatgpt', 'error')
      addRun(db, {
        id: 'r-open',
        startedAt: '2026-10-22T12:00:00.000Z',
        engines: ['google_aio', 'gemini'],
        status: 'running'
      })
      addGoogle(db, 'r-open', ONE.id, 1, 'no_aio')
      addAnswer(db, 'r-open', ONE.id, 'gemini', 'cited')

      // The UK market has its own answers.
      addRun(db, {
        id: 'r-uk',
        startedAt: '2026-10-20T13:00:00.000Z',
        engines: ['gemini'],
        marketId: P.uk
      })
      addAnswer(db, 'r-uk', ONE.id, 'gemini', 'cited', 1, { checkedAt: '2026-10-20T13:00:30.000Z' })
    })
  }

  test('each engine’s latest check, samples rolled up, in the page’s default market', async () => {
    const seed = openEngineSeed({ cloro: true })
    await seed.handlers['engines:set']({
      ...base,
      engines: ['google_aio', 'chatgpt', 'perplexity']
    })
    seedAnswers(seed)
    const view = await seed.handlers['engines:question'](question)
    expect(view).toMatchObject({
      projectId: P.projectId,
      pageId: P.pageId,
      promptId: ONE.id,
      marketId: P.us
    })
    expect(view.engines.map((item) => item.engine)).toEqual([...ENGINE_IDS])
    expect(view.engines.map((item) => item.selected)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false
    ])
    expect(view.engines.map((item) => item.status)).toEqual([
      'cited',
      'named',
      'no_answer',
      null,
      null,
      null
    ])

    const [google, chatgpt, perplexity, aiMode] = view.engines
    expect(google).toEqual({
      engine: 'google_aio',
      label: 'Google AI Overview',
      selected: true,
      status: 'cited',
      checkedAt: finishedAt('2026-10-20T12:00:00.000Z'),
      cited: true,
      // Another sample named the brand.
      named: true,
      citedUrl: PAGE_URL,
      position: 2,
      text: 'Overview 2',
      markdown: '**Overview** 2',
      sources: [
        {
          position: 1,
          url: 'https://twilio.com/p1',
          domain: 'twilio.com',
          title: 'twilio.com 1',
          classification: 'competitor'
        },
        {
          position: 2,
          url: PAGE_URL,
          domain: 'textbolt.com',
          title: 'textbolt.com 2',
          classification: 'target'
        }
      ],
      message: null,
      provider: 'cloro',
      credits: 21,
      costMicros: 16_800
    })
    expect(chatgpt).toMatchObject({
      status: 'named',
      cited: false,
      named: true,
      citedUrl: null,
      position: null,
      text: 'chatgpt answer 1',
      markdown: '**chatgpt** answer 1',
      checkedAt: '2026-10-20T12:00:30.000Z',
      provider: 'cloro',
      credits: 14,
      costMicros: 14 * MICROS_PER_LITE_CREDIT
    })
    expect(chatgpt!.sources.map((item) => item.domain)).toEqual([
      'simpletexting.com',
      'twilio.com',
      'reddit.com'
    ])
    expect(perplexity).toMatchObject({
      status: 'no_answer',
      cited: false,
      named: false,
      text: 'perplexity answer 2',
      message: null,
      credits: 6
    })
    expect(aiMode).toEqual({
      engine: 'google_ai_mode',
      label: 'Google AI Mode',
      selected: false,
      status: null,
      checkedAt: null,
      cited: false,
      named: false,
      citedUrl: null,
      position: null,
      text: null,
      markdown: null,
      sources: [],
      message: null,
      provider: null,
      credits: 0,
      costMicros: 0
    })
  })

  test('a market asked for shows that market’s answers; a page’s own engines drive `selected`', async () => {
    const seed = openEngineSeed({ cloro: true })
    seedAnswers(seed)
    await seed.handlers['engines:setPage']({ ...page, engines: ['gemini'] })
    const view = await seed.handlers['engines:question']({ ...question, marketId: P.uk })
    expect(view.marketId).toBe(P.uk)
    expect(view.engines.map((item) => item.status)).toEqual([null, null, null, null, 'cited', null])
    expect(view.engines.map((item) => item.selected)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false
    ])
    expect(view.engines[4]).toMatchObject({ cited: true, citedUrl: PAGE_URL, position: 1 })
  })

  test('an error sample alone shows the error and its message', async () => {
    const seed = openEngineSeed({ cloro: true })
    withDb(seed, (db) => {
      addRun(db, { id: 'r-1', startedAt: '2026-10-20T12:00:00.000Z', engines: ['copilot'] })
      addAnswer(db, 'r-1', THREE.id, 'copilot', 'error', 1, { credits: 0, costMicros: 0 })
    })
    const view = await seed.handlers['engines:question']({ ...page, promptId: THREE.id })
    expect(view.engines[5]).toMatchObject({
      engine: 'copilot',
      status: 'error',
      message: 'cloro timed out',
      credits: 0
    })
  })

  test('an unknown page is not found; a malformed request is refused', async () => {
    const seed = openEngineSeed()
    await expect(
      seed.handlers['engines:question']({ ...question, pageId: 'page-404' })
    ).rejects.toThrow('That page was not found')
    await expect(
      call(seed.handlers, 'engines:question', { ...question, promptId: '' })
    ).rejects.toThrow()
    await expect(
      call(seed.handlers, 'engines:question', { ...question, marketId: 4 })
    ).rejects.toThrow()
  })
})

describe('engines:summary', () => {
  const R1 = '2026-10-10T12:00:00.000Z'
  const R2 = '2026-10-20T12:00:00.000Z'
  const R2_ANSWERED = '2026-10-20T12:00:30.000Z'
  const UK_AT = '2026-10-20T13:00:00.000Z'

  function seedChecks(seed: ReturnType<typeof openEngineSeed>): void {
    withDb(seed, (db) => {
      const both: EngineId[] = ['google_aio', 'chatgpt']
      addRun(db, { id: 'r1', startedAt: R1, engines: both })
      addGoogle(db, 'r1', ONE.id, 1, 'not_cited')
      addGoogle(db, 'r1', TWO.id, 1, 'page_cited')
      addGoogle(db, 'r1', THREE.id, 1, 'no_aio')
      const at1 = { checkedAt: '2026-10-10T12:00:30.000Z' }
      addAnswer(db, 'r1', ONE.id, 'chatgpt', 'not_cited', 1, at1)
      addAnswer(db, 'r1', TWO.id, 'chatgpt', 'cited', 1, at1)
      addAnswer(db, 'r1', THREE.id, 'chatgpt', 'named', 1, at1)

      addRun(db, { id: 'r2', startedAt: R2, engines: both })
      addGoogle(db, 'r2', ONE.id, 1, 'page_cited')
      addGoogle(db, 'r2', TWO.id, 1, 'not_cited')
      addGoogle(db, 'r2', THREE.id, 1, 'no_aio')
      addGoogle(db, 'r2', THREE.id, 2, 'brand_mentioned', { named: true })
      addAnswer(db, 'r2', ONE.id, 'chatgpt', 'not_cited', 1)
      addAnswer(db, 'r2', ONE.id, 'chatgpt', 'cited', 2)
      addAnswer(db, 'r2', TWO.id, 'chatgpt', 'cited', 1)
      addAnswer(db, 'r2', THREE.id, 'chatgpt', 'unavailable', 1)

      // Ignored: a cancelled check and an unfinished one.
      addRun(db, {
        id: 'r3',
        startedAt: '2026-10-21T12:00:00.000Z',
        engines: both,
        status: 'cancelled'
      })
      for (const prompt of P.prompts) addGoogle(db, 'r3', prompt.id, 1, 'error')
      addAnswer(db, 'r3', ONE.id, 'chatgpt', 'error')
      addRun(db, {
        id: 'r4',
        startedAt: '2026-10-22T12:00:00.000Z',
        engines: both,
        status: 'running'
      })
      addGoogle(db, 'r4', TWO.id, 1, 'page_cited')
      addAnswer(db, 'r4', THREE.id, 'chatgpt', 'cited')

      // The UK checks Google and Perplexity, an engine the project does not pick.
      addRun(db, {
        id: 'r5',
        startedAt: UK_AT,
        engines: ['google_aio', 'perplexity'],
        marketId: P.uk
      })
      addGoogle(db, 'r5', ONE.id, 1, 'error')
      const atUk = { checkedAt: '2026-10-20T13:00:30.000Z' }
      addAnswer(db, 'r5', ONE.id, 'perplexity', 'cited', 1, atUk)
      addAnswer(db, 'r5', TWO.id, 'perplexity', 'named', 1, atUk)
    })
  }

  const zero = {
    checked: 0,
    cited: 0,
    named: 0,
    notCited: 0,
    noAnswer: 0,
    unavailable: 0,
    error: 0,
    gained: 0,
    lost: 0,
    lastCheckedAt: null
  }

  test('counts each engine’s latest status per question × market, and what moved', async () => {
    const seed = openEngineSeed({ cloro: true })
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'chatgpt'] })
    seedChecks(seed)
    const summary = await seed.handlers['engines:summary'](base)
    expect(summary.projectId).toBe(P.projectId)
    expect(summary.engines).toEqual(['google_aio', 'chatgpt'])
    expect(summary.questions).toBeUndefined()
    expect(summary.counts).toEqual([
      {
        engine: 'google_aio',
        label: 'Google AI Overview',
        checked: 4,
        cited: 1,
        named: 1,
        notCited: 1,
        noAnswer: 0,
        unavailable: 0,
        error: 1,
        gained: 1,
        lost: 1,
        lastCheckedAt: finishedAt(UK_AT)
      },
      {
        engine: 'chatgpt',
        label: 'ChatGPT',
        checked: 3,
        cited: 2,
        named: 0,
        notCited: 0,
        noAnswer: 0,
        unavailable: 1,
        error: 0,
        gained: 1,
        lost: 0,
        lastCheckedAt: R2_ANSWERED
      },
      {
        engine: 'perplexity',
        label: 'Perplexity',
        checked: 2,
        cited: 1,
        named: 1,
        notCited: 0,
        noAnswer: 0,
        unavailable: 0,
        error: 0,
        gained: 0,
        lost: 0,
        lastCheckedAt: '2026-10-20T13:00:30.000Z'
      }
    ])
  })

  test('one market, and each question’s statuses on the pages asked for', async () => {
    const seed = openEngineSeed({ cloro: true })
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'chatgpt'] })
    seedChecks(seed)
    const summary = await seed.handlers['engines:summary']({
      ...base,
      pageIds: [P.pageId],
      marketId: P.us,
      perQuestion: true
    })
    expect(summary.counts.map((count) => count.engine)).toEqual(['google_aio', 'chatgpt'])
    expect(summary.counts[0]).toMatchObject({ checked: 3, error: 0, lastCheckedAt: finishedAt(R2) })
    const statuses = new Map((summary.questions ?? []).map((item) => [item.promptId, item]))
    expect(statuses.size).toBe(3)
    expect(statuses.get(ONE.id)).toEqual({
      pageId: P.pageId,
      promptId: ONE.id,
      marketId: P.us,
      statuses: { google_aio: 'cited', chatgpt: 'cited' },
      // Cited now and not at the previous check on each engine (Summary's gained/lost drills).
      moved: { google_aio: 'gained', chatgpt: 'gained' }
    })
    expect(statuses.get(TWO.id)?.statuses).toEqual({ google_aio: 'not_cited', chatgpt: 'cited' })
    expect(statuses.get(THREE.id)?.statuses).toEqual({
      google_aio: 'named',
      chatgpt: 'unavailable'
    })
  })

  test('no checks: zero counts for the project’s engines', async () => {
    const seed = openEngineSeed()
    const summary = await seed.handlers['engines:summary'](base)
    expect(summary.counts).toEqual([{ engine: 'google_aio', label: 'Google AI Overview', ...zero }])
  })

  test('questions of a prompt set that is no longer active are not counted', async () => {
    const seed = openEngineSeed({ cloro: true })
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'chatgpt'] })
    seedChecks(seed)
    withDb(seed, (db) => {
      replacePromptSet(db, 'prompt-new')
      addRun(db, { id: 'r6', startedAt: '2026-10-23T12:00:00.000Z', promptSetId: 'pset-2' })
      addGoogle(db, 'r6', 'prompt-new', 1, 'page_cited')
    })
    const summary = await seed.handlers['engines:summary'](base)
    expect(summary.counts).toEqual([
      {
        engine: 'google_aio',
        label: 'Google AI Overview',
        ...zero,
        checked: 1,
        cited: 1,
        lastCheckedAt: finishedAt('2026-10-23T12:00:00.000Z')
      },
      { engine: 'chatgpt', label: 'ChatGPT', ...zero }
    ])
  })

  test('per question needs pageIds (at most 50); a malformed request is refused', async () => {
    const seed = openEngineSeed()
    await expect(seed.handlers['engines:summary']({ ...base, perQuestion: true })).rejects.toThrow(
      "Ask for each question's statuses on up to 50 pages at a time"
    )
    await expect(
      seed.handlers['engines:summary']({
        ...base,
        perQuestion: true,
        pageIds: Array.from({ length: 51 }, (_, index) => `page-${index}`)
      })
    ).rejects.toThrow()
    await expect(
      call(seed.handlers, 'engines:summary', { ...base, perQuestion: 'yes' })
    ).rejects.toThrow()
    await expect(
      call(seed.handlers, 'engines:summary', { ...base, marketId: '../x' })
    ).rejects.toThrow()
  })
})

describe('engines:spend', () => {
  function seedSpend(seed: ReturnType<typeof openEngineSeed>): void {
    withDb(seed, (db) => {
      addBrandPrompts(db)
      // A cloro check of Google and ChatGPT with a brand prompt.
      addRun(db, {
        id: 'ra',
        startedAt: '2026-10-10T12:00:00.000Z',
        engines: ['google_aio', 'chatgpt']
      })
      const cloro = { provider: 'cloro' as const, credits: 7, costMicros: 5_600 }
      addGoogle(db, 'ra', ONE.id, 1, 'not_cited', cloro)
      addGoogle(db, 'ra', TWO.id, 1, 'not_cited', cloro)
      addBrandCapture(db, 'ra', { searches: 1, credits: 7, costMicros: 5_600 })
      addAnswer(db, 'ra', ONE.id, 'chatgpt', 'cited')
      addAnswer(db, 'ra', TWO.id, 'chatgpt', 'not_cited')
      finishJob(db, 'job-ra', {
        searches: 5,
        credits: 35,
        costMicros: 28_000,
        provider: 'cloro',
        at: finishedAt('2026-10-10T12:00:00.000Z')
      })
      // A SerpApi check of Google alone.
      addRun(db, { id: 'rb', startedAt: '2026-10-20T12:00:00.000Z' })
      for (const prompt of P.prompts) {
        addGoogle(db, 'rb', prompt.id, 1, 'not_cited', { costMicros: 25_000 })
      }
      finishJob(db, 'job-rb', {
        searches: 3,
        credits: 0,
        costMicros: 75_000,
        provider: 'serpapi',
        at: finishedAt('2026-10-20T12:00:00.000Z')
      })
      // A check from before cloro, cancelled before any run.
      addEmptyJob(db, 'job-legacy', '2026-10-05T12:00:00.000Z')
      finishJob(db, 'job-legacy', {
        status: 'cancelled',
        searches: 0,
        credits: 0,
        costMicros: 0,
        provider: null,
        at: '2026-10-05T12:00:10.000Z'
      })
      // Last month.
      addRun(db, {
        id: 'rc',
        startedAt: '2026-09-15T12:00:00.000Z',
        engines: ['google_aio', 'gemini']
      })
      addGoogle(db, 'rc', ONE.id, 1, 'not_cited', cloro)
      addAnswer(db, 'rc', ONE.id, 'gemini', 'cited')
      finishJob(db, 'job-rc', {
        searches: 2,
        credits: 13,
        costMicros: 10_400,
        provider: 'cloro',
        at: finishedAt('2026-09-15T12:00:00.000Z')
      })
    })
    const usage = (
      id: string,
      keyId: string,
      month: string,
      searches: number,
      credits: number
    ): void =>
      addKeyUsage(seed.storage.db, {
        id,
        keyId,
        projectId: id === 'u-free' ? null : P.projectId,
        month,
        searches,
        calls: searches,
        tokens: 0,
        credits
      })
    usage('u-serp', 'key-1', '2026-10', 3, 0)
    usage('u-cloro', 'key-cloro', '2026-10', 5, 35)
    usage('u-free', 'key-cloro', '2026-10', 2, 14)
    usage('u-old', 'key-cloro', '2026-09', 9, 63)
  }

  test('the month’s checks, what each engine spent, and every project’s use of each provider', async () => {
    const seed = openEngineSeed({ cloro: true })
    seedSpend(seed)
    const spend = await seed.handlers['engines:spend']({ ...base, month: '2026-10' })
    expect(spend.projectId).toBe(P.projectId)
    expect(spend.month).toBe('2026-10')
    expect(spend.total).toEqual({ searches: 8, credits: 35, costMicros: 103_000, checks: 3 })
    expect(spend.byEngine).toEqual([
      {
        engine: 'google_aio',
        label: 'Google AI Overview',
        searches: 2 + 1 + 3,
        credits: 21,
        costMicros: 3 * 5_600 + 75_000
      },
      {
        engine: 'chatgpt',
        label: 'ChatGPT',
        searches: 2,
        credits: 14,
        costMicros: 14 * MICROS_PER_LITE_CREDIT
      }
    ])
    expect(spend.checks.map((check) => check.jobId)).toEqual(['job-rb', 'job-ra', 'job-legacy'])
    expect(spend.checks[0]).toEqual({
      jobId: 'job-rb',
      startedAt: '2026-10-20T12:00:00.000Z',
      finishedAt: finishedAt('2026-10-20T12:00:00.000Z'),
      status: 'finished',
      provider: 'serpapi',
      searches: 3,
      credits: 0,
      costMicros: 75_000,
      engines: ['google_aio']
    })
    expect(spend.checks[1]).toMatchObject({
      provider: 'cloro',
      credits: 35,
      costMicros: 28_000,
      engines: ['google_aio', 'chatgpt']
    })
    expect(spend.checks[2]).toMatchObject({ status: 'cancelled', provider: null, engines: [] })
    expect(spend.account).toEqual([
      { provider: 'cloro', searches: 7, credits: 49 },
      { provider: 'serpapi', searches: 3, credits: 0 }
    ])
  })

  test('another month, and this month by default', async () => {
    const seed = openEngineSeed({ cloro: true })
    seedSpend(seed)
    const september = await seed.handlers['engines:spend']({ ...base, month: '2026-09' })
    expect(september.total).toEqual({ searches: 2, credits: 13, costMicros: 10_400, checks: 1 })
    expect(september.byEngine.map((item) => [item.engine, item.credits])).toEqual([
      ['google_aio', 7],
      ['gemini', 6]
    ])
    expect(september.account).toEqual([{ provider: 'cloro', searches: 9, credits: 63 }])
    // The seed clock is in October 2026.
    const current = await seed.handlers['engines:spend'](base)
    expect(current.month).toBe('2026-10')
    expect(current.total.checks).toBe(3)
    const empty = await seed.handlers['engines:spend']({ ...base, month: '2025-01' })
    expect(empty).toMatchObject({
      total: { searches: 0, credits: 0, costMicros: 0, checks: 0 },
      byEngine: [],
      checks: [],
      account: []
    })
  })

  test('an invalid month is refused', async () => {
    const seed = openEngineSeed()
    for (const month of ['2026-13', '2026-1', '26-10', '2026-10-01', 202610]) {
      await expect(call(seed.handlers, 'engines:spend', { ...base, month })).rejects.toThrow()
    }
  })
})
