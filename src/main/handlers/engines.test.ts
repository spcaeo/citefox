import { afterEach, describe, expect, test } from 'vitest'
import { ENGINE_IDS, type EngineId } from '@shared/domain'
import type { EngineEstimate } from '@shared/ipc'
import { insertPage } from '../storage/pages'
import {
  addBrandPrompts,
  addCloroKey,
  callRaw as call,
  cleanupEngineSeeds,
  MICROS_PER_LITE_CREDIT,
  openEngineSeed,
  PROGRESS_SEED,
  serpApiOnStarter,
  withDb
} from './engines.test-helper'

/** `engines:get`, `engines:set`, `engines:page`, `engines:setPage` and `engines:estimate`. */

afterEach(() => {
  cleanupEngineSeeds()
})

const P = PROGRESS_SEED
const base = { projectId: P.projectId }
const page = { ...base, pageId: P.pageId }
const LITE = { provider: 'cloro', label: 'Lite', usd: 30, units: 37_500 }
const STARTER = { provider: 'serpapi', label: 'Starter', usd: 25, units: 1_000 }
/** Starter: $25 / 1,000 searches. */
const MICROS_PER_STARTER_SEARCH = 25_000

describe('engines:get', () => {
  test('a project that never chose: Google AI Overview on SerpApi, answer engines not runnable', async () => {
    const seed = openEngineSeed()
    const view = await seed.handlers['engines:get'](base)
    expect(view).toMatchObject({
      projectId: P.projectId,
      engines: ['google_aio'],
      provider: 'auto',
      activeProvider: 'serpapi',
      cloroReady: false,
      serpapiReady: true,
      overrides: 0,
      updatedAt: null
    })
    expect(view.options.map((option) => option.id)).toEqual([...ENGINE_IDS])
    expect(view.options.map((option) => option.credits)).toEqual([7, 7, 6, 6, 6, 7])
    expect(view.options.filter((option) => option.runnable).map((option) => option.id)).toEqual([
      'google_aio'
    ])
    expect(view.options.filter((option) => !option.needsCloro).map((option) => option.id)).toEqual([
      'google_aio'
    ])
    expect(view.options[1]).toEqual({
      id: 'chatgpt',
      label: 'ChatGPT',
      credits: 7,
      needsCloro: true,
      runnable: false
    })
  })

  test('an on cloro key: cloro ready, auto runs Google on cloro, every engine runnable', async () => {
    const seed = openEngineSeed({ cloro: true })
    const view = await seed.handlers['engines:get'](base)
    expect(view.cloroReady).toBe(true)
    expect(view.activeProvider).toBe('cloro')
    expect(view.provider).toBe('auto')
    expect(view.options.every((option) => option.runnable)).toBe(true)
  })

  test('an off cloro key, or one kept for another project, is not one this project may use', async () => {
    const off = openEngineSeed()
    addCloroKey(off, { on: false })
    expect(await off.handlers['engines:get'](base)).toMatchObject({
      cloroReady: false,
      activeProvider: 'serpapi'
    })
    const elsewhere = openEngineSeed()
    addCloroKey(elsewhere, { projectIds: ['proj-other'] })
    expect(await elsewhere.handlers['engines:get'](base)).toMatchObject({
      cloroReady: false,
      activeProvider: 'serpapi'
    })
  })

  test('a malformed request or an unknown project is refused', async () => {
    const seed = openEngineSeed()
    await expect(call(seed.handlers, 'engines:get', { projectId: '../x' })).rejects.toThrow()
    await expect(call(seed.handlers, 'engines:get', null)).rejects.toThrow()
    await expect(call(seed.handlers, 'engines:get', { projectId: 'proj-none' })).rejects.toThrow()
  })
})

describe('engines:set', () => {
  test('saves the engines in display order, without repeats; get reads them back', async () => {
    const seed = openEngineSeed({ cloro: true })
    const saved = await seed.handlers['engines:set']({
      ...base,
      engines: ['perplexity', 'google_aio', 'chatgpt', 'chatgpt']
    })
    expect(saved.engines).toEqual(['google_aio', 'chatgpt', 'perplexity'])
    expect(saved.provider).toBe('auto')
    expect(saved.updatedAt).toEqual(expect.any(String))
    const read = await seed.handlers['engines:get'](base)
    expect(read.engines).toEqual(['google_aio', 'chatgpt', 'perplexity'])
    expect(read.updatedAt).toBe(saved.updatedAt)
  })

  test('an empty list or an unknown engine is refused and nothing changes', async () => {
    const seed = openEngineSeed()
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'gemini'] })
    await expect(seed.handlers['engines:set']({ ...base, engines: [] })).rejects.toThrow(
      'Pick at least one engine'
    )
    await expect(
      call(seed.handlers, 'engines:set', { ...base, engines: ['google_aio', 'bing'] })
    ).rejects.toThrow('Unknown engine')
    expect((await seed.handlers['engines:get'](base)).engines).toEqual(['google_aio', 'gemini'])
  })

  test('a provider change is kept with the engines, and each field left out keeps its value', async () => {
    const seed = openEngineSeed()
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'copilot'] })
    const provider = await seed.handlers['engines:set']({ ...base, provider: 'cloro' })
    expect(provider.engines).toEqual(['google_aio', 'copilot'])
    expect(provider.provider).toBe('cloro')
    // An explicit choice is kept with no key of that provider, so the check names the key to add.
    expect(provider.activeProvider).toBe('cloro')
    const engines = await seed.handlers['engines:set']({ ...base, engines: ['chatgpt'] })
    expect(engines.provider).toBe('cloro')
    expect(engines.engines).toEqual(['chatgpt'])
    const serp = await seed.handlers['engines:set']({ ...base, provider: 'serpapi' })
    expect(serp).toMatchObject({ provider: 'serpapi', activeProvider: 'serpapi' })
  })

  test('a saved SerpApi choice wins over a cloro key', async () => {
    const seed = openEngineSeed({ cloro: true })
    const view = await seed.handlers['engines:set']({ ...base, provider: 'serpapi' })
    expect(view).toMatchObject({ provider: 'serpapi', activeProvider: 'serpapi', cloroReady: true })
  })

  test('bad request shapes are refused', async () => {
    const seed = openEngineSeed()
    for (const request of [
      null,
      [],
      'proj-1',
      { projectId: 7 },
      { ...base, engines: 'google_aio' },
      { ...base, engines: null },
      { ...base, engines: Array.from({ length: 13 }, () => 'google_aio') },
      { ...base, provider: 'bing' },
      { ...base, provider: null }
    ]) {
      await expect(call(seed.handlers, 'engines:set', request)).rejects.toThrow()
    }
    expect(await seed.handlers['engines:get'](base)).toMatchObject({
      engines: ['google_aio'],
      provider: 'auto',
      updatedAt: null
    })
  })
})

describe('engines:page and engines:setPage', () => {
  test('a page follows the project until it has its own engines; null returns it', async () => {
    const seed = openEngineSeed()
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'perplexity'] })
    expect(await seed.handlers['engines:page'](page)).toEqual({
      projectId: P.projectId,
      pageId: P.pageId,
      kind: 'page',
      engines: ['google_aio', 'perplexity'],
      own: null,
      projectEngines: ['google_aio', 'perplexity']
    })

    const own = await seed.handlers['engines:setPage']({ ...page, engines: ['gemini', 'chatgpt'] })
    expect(own).toMatchObject({ engines: ['chatgpt', 'gemini'], own: ['chatgpt', 'gemini'] })
    expect((await seed.handlers['engines:get'](base)).overrides).toBe(1)
    // The project changing does not move a page with its own engines.
    await seed.handlers['engines:set']({ ...base, engines: ['copilot'] })
    expect(await seed.handlers['engines:page'](page)).toMatchObject({
      engines: ['chatgpt', 'gemini'],
      own: ['chatgpt', 'gemini'],
      projectEngines: ['copilot']
    })

    const reset = await seed.handlers['engines:setPage']({ ...page, engines: null })
    expect(reset).toMatchObject({ engines: ['copilot'], own: null })
    expect((await seed.handlers['engines:get'](base)).overrides).toBe(0)

    await seed.handlers['engines:setPage']({ ...page, engines: ['gemini'] })
    const emptied = await seed.handlers['engines:setPage']({ ...page, engines: [] })
    expect(emptied).toMatchObject({ engines: ['copilot'], own: null })
  })

  test('a topic reports its kind', async () => {
    const seed = openEngineSeed()
    withDb(seed, (db) => {
      insertPage(db, {
        id: 'topic-1',
        projectId: P.projectId,
        kind: 'topic',
        url: null,
        title: 'Crew alerts',
        label: null,
        folder: null,
        status: 'tracked',
        setupStep: null,
        intervalDays: 14,
        samples: 1,
        promptCount: 1,
        defaultMarketId: P.us,
        pinned: false,
        score: null,
        promptSetVersion: null
      })
    })
    const view = await seed.handlers['engines:setPage']({
      ...base,
      pageId: 'topic-1',
      engines: ['chatgpt']
    })
    expect(view).toMatchObject({ pageId: 'topic-1', kind: 'topic', own: ['chatgpt'] })
    expect((await seed.handlers['engines:page']({ ...base, pageId: 'topic-1' })).kind).toBe('topic')
  })

  test('an unknown or removed page is not found; bad engines are refused', async () => {
    const seed = openEngineSeed()
    await expect(seed.handlers['engines:page']({ ...base, pageId: 'page-404' })).rejects.toThrow(
      'That page was not found'
    )
    await expect(
      seed.handlers['engines:setPage']({ ...base, pageId: 'page-404', engines: ['chatgpt'] })
    ).rejects.toThrow('That page was not found')
    await expect(
      call(seed.handlers, 'engines:setPage', { ...page, engines: ['bing'] })
    ).rejects.toThrow('Unknown engine')
    await expect(call(seed.handlers, 'engines:setPage', page)).rejects.toThrow()
    await expect(call(seed.handlers, 'engines:page', { ...base, pageId: '../x' })).rejects.toThrow()
    await seed.handlers['pages:remove'](page)
    await expect(seed.handlers['engines:page'](page)).rejects.toThrow('That page was not found')
  })
})

describe('engines:estimate', () => {
  /** 3 prompts × 2 markets × 2 samples on the seeded page, tracked every 14 days. */
  const CALLS = 3 * 2 * 2
  const perMonth = (value: number): number => Math.round((value * 30) / 14)

  function twoSamples(seed: ReturnType<typeof openEngineSeed>): void {
    withDb(seed, (db) => db.prepare(`UPDATE pages SET samples = 2 WHERE id = ?`).run(P.pageId))
  }

  function row(estimate: EngineEstimate, engine: EngineId): EngineEstimate['byEngine'][number] {
    const found = estimate.byEngine.find((item) => item.engine === engine)
    if (found === undefined) throw new Error(`no ${engine} row`)
    return found
  }

  test('with a cloro key: questions × markets × samples × each engine’s credits, at Lite', async () => {
    const seed = openEngineSeed({ cloro: true })
    twoSamples(seed)
    await seed.handlers['engines:set']({
      ...base,
      engines: ['google_aio', 'chatgpt', 'perplexity']
    })
    const estimate = await seed.handlers['engines:estimate'](base)
    const credits = CALLS * (7 + 7 + 6)
    expect(estimate).toMatchObject({
      projectId: P.projectId,
      provider: 'cloro',
      cloroReady: true,
      pages: 1,
      questions: 6,
      skipped: [],
      plans: [LITE]
    })
    expect(estimate.perCheck).toEqual({
      searches: CALLS * 3,
      credits,
      costMicros: credits * MICROS_PER_LITE_CREDIT
    })
    expect(estimate.perMonth).toEqual({
      searches: perMonth(CALLS * 3),
      credits: perMonth(credits),
      costMicros: perMonth(credits * MICROS_PER_LITE_CREDIT)
    })
    expect(estimate.byEngine.map((item) => item.engine)).toEqual([
      'google_aio',
      'chatgpt',
      'perplexity'
    ])
    expect(row(estimate, 'google_aio')).toEqual({
      engine: 'google_aio',
      label: 'Google AI Overview',
      calls: CALLS,
      searches: CALLS,
      credits: CALLS * 7,
      costMicros: CALLS * 7 * MICROS_PER_LITE_CREDIT,
      runnable: true
    })
    expect(row(estimate, 'perplexity')).toMatchObject({ calls: CALLS, credits: CALLS * 6 })
  })

  test('brand prompts add Google AI Overview calls in each market of their language', async () => {
    const seed = openEngineSeed({ cloro: true })
    twoSamples(seed)
    withDb(seed, addBrandPrompts)
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'chatgpt'] })
    const estimate = await seed.handlers['engines:estimate'](base)
    // Two English brand prompts in two English markets; the Spanish one runs nowhere.
    expect(row(estimate, 'google_aio')).toMatchObject({
      calls: CALLS + 4,
      credits: (CALLS + 4) * 7
    })
    expect(row(estimate, 'chatgpt')).toMatchObject({ calls: CALLS, credits: CALLS * 7 })
    expect(estimate.perCheck.credits).toBe((CALLS + 4) * 7 + CALLS * 7)
  })

  test('without a cloro key the answer engines are skipped and left out of the totals', async () => {
    const seed = openEngineSeed()
    twoSamples(seed)
    serpApiOnStarter(seed)
    await seed.handlers['engines:set']({
      ...base,
      engines: ['google_aio', 'chatgpt', 'perplexity']
    })
    const estimate = await seed.handlers['engines:estimate'](base)
    expect(estimate).toMatchObject({
      provider: 'serpapi',
      cloroReady: false,
      skipped: ['chatgpt', 'perplexity'],
      plans: [STARTER]
    })
    expect(estimate.perCheck).toEqual({
      searches: CALLS,
      credits: 0,
      costMicros: CALLS * MICROS_PER_STARTER_SEARCH
    })
    expect(row(estimate, 'chatgpt')).toEqual({
      engine: 'chatgpt',
      label: 'ChatGPT',
      calls: 0,
      searches: 0,
      credits: 0,
      costMicros: 0,
      runnable: false
    })
    expect(row(estimate, 'google_aio')).toMatchObject({ runnable: true, credits: 0 })
  })

  test('a SerpApi provider prices Google per search with no credits; answer engines stay on cloro', async () => {
    const seed = openEngineSeed({ cloro: true })
    twoSamples(seed)
    serpApiOnStarter(seed)
    await seed.handlers['engines:set']({ ...base, engines: ['google_aio', 'chatgpt'] })
    const estimate = await seed.handlers['engines:estimate']({ ...base, provider: 'serpapi' })
    expect(estimate.provider).toBe('serpapi')
    expect(row(estimate, 'google_aio')).toMatchObject({
      calls: CALLS,
      searches: CALLS,
      credits: 0,
      costMicros: CALLS * MICROS_PER_STARTER_SEARCH
    })
    expect(row(estimate, 'chatgpt')).toMatchObject({
      credits: CALLS * 7,
      costMicros: CALLS * 7 * MICROS_PER_LITE_CREDIT
    })
    expect(estimate.perCheck).toEqual({
      searches: CALLS * 2,
      credits: CALLS * 7,
      costMicros: CALLS * MICROS_PER_STARTER_SEARCH + CALLS * 7 * MICROS_PER_LITE_CREDIT
    })
    expect(estimate.plans).toEqual([LITE, STARTER])
    // The preview is not saved.
    expect((await seed.handlers['engines:get'](base)).provider).toBe('auto')
  })

  test('an engines preview with pageIds replaces the page’s own engines', async () => {
    const seed = openEngineSeed({ cloro: true })
    await seed.handlers['engines:setPage']({ ...page, engines: ['google_aio'] })
    const picked = await seed.handlers['engines:estimate']({
      ...base,
      pageIds: [P.pageId],
      engines: ['gemini']
    })
    expect(picked.byEngine.map((item) => item.engine)).toEqual(['gemini'])
    expect(picked.perCheck.credits).toBe(6 * 6)
    expect((await seed.handlers['engines:page'](page)).own).toEqual(['google_aio'])
  })

  test('with no pageIds only pages that follow the project take the preview', async () => {
    const seed = openEngineSeed({ cloro: true })
    await seed.handlers['engines:setPage']({ ...page, engines: ['google_aio'] })
    const own = await seed.handlers['engines:estimate']({ ...base, engines: ['gemini'] })
    expect(own.byEngine.map((item) => item.engine)).toEqual(['google_aio'])
    await seed.handlers['engines:setPage']({ ...page, engines: null })
    const follows = await seed.handlers['engines:estimate']({ ...base, engines: ['gemini'] })
    expect(follows.byEngine.map((item) => item.engine)).toEqual(['gemini'])
    expect(follows.perCheck).toEqual({
      searches: 6,
      credits: 36,
      costMicros: 36 * MICROS_PER_LITE_CREDIT
    })
  })

  test('a paused page asked for by id costs per check but nothing a month; unlisted otherwise', async () => {
    const seed = openEngineSeed({ cloro: true })
    withDb(seed, (db) =>
      db.prepare(`UPDATE pages SET status = 'paused' WHERE id = ?`).run(P.pageId)
    )
    const picked = await seed.handlers['engines:estimate']({ ...base, pageIds: [P.pageId] })
    expect(picked.perCheck.credits).toBe(6 * 7)
    expect(picked.perMonth).toEqual({ searches: 0, credits: 0, costMicros: 0 })
    const all = await seed.handlers['engines:estimate'](base)
    expect(all).toMatchObject({ pages: 0, questions: 0, byEngine: [], plans: [] })
  })

  test('an unknown page, an empty preview or a bad provider is refused', async () => {
    const seed = openEngineSeed()
    await expect(
      seed.handlers['engines:estimate']({ ...base, pageIds: ['page-404'] })
    ).rejects.toThrow('That page was not found')
    await expect(seed.handlers['engines:estimate']({ ...base, engines: [] })).rejects.toThrow(
      'Pick at least one engine'
    )
    await expect(
      call(seed.handlers, 'engines:estimate', { ...base, provider: 'bing' })
    ).rejects.toThrow()
    await expect(
      call(seed.handlers, 'engines:estimate', { ...base, pageIds: 'page-1' })
    ).rejects.toThrow()
  })
})
