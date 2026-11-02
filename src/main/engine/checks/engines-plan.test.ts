import { providerPlan } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import type { QueueProjectInput } from '../../queue/types'
import { getApiKey, updateApiKey } from '../../storage/records'
import { saveEngineSettings, savePageEngines } from '../../storage/engine-records'
import { closeSeeds, NOW, seed } from './checks.test-helper'
import { addCloroKey } from './engines.test-helper'
import {
  answerEnginesOf,
  cloroAvailable,
  keyPricing,
  resolveProvider,
  runnableEngines,
  selectedEngines
} from './engines-plan'

afterEach(() => {
  closeSeeds()
})

function project(overrides: Partial<QueueProjectInput> = {}): QueueProjectInput {
  return {
    projectId: 'proj-1',
    name: 'TextBolt',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false,
    ...overrides
  }
}

async function seeded(): Promise<Awaited<ReturnType<typeof seed>>> {
  return seed({
    progress: [],
    http: () => {
      throw new Error('no HTTP in these tests')
    }
  })
}

describe('runnableEngines and answerEnginesOf', () => {
  test('keeps display order, and drops answer engines without a cloro key', () => {
    expect(runnableEngines(['copilot', 'google_aio', 'chatgpt'], true)).toEqual([
      'google_aio',
      'chatgpt',
      'copilot'
    ])
    expect(runnableEngines(['copilot', 'google_aio', 'chatgpt'], false)).toEqual(['google_aio'])
    expect(runnableEngines(['chatgpt', 'gemini'], false)).toEqual([])
    expect(runnableEngines([], true)).toEqual([])
  })

  test('answer engines are every engine but Google AI Overview', () => {
    expect(answerEnginesOf(['google_aio', 'perplexity', 'google_ai_mode'])).toEqual([
      'perplexity',
      'google_ai_mode'
    ])
    expect(answerEnginesOf(['google_aio'])).toEqual([])
  })
})

describe('resolveProvider and cloroAvailable', () => {
  test('auto is SerpApi with no cloro key; explicit choices are kept', async () => {
    const { storage } = await seeded()
    expect(cloroAvailable(storage, project())).toBe(false)
    expect(resolveProvider(storage, project(), 'auto')).toBe('serpapi')
    expect(resolveProvider(storage, project(), 'cloro')).toBe('cloro')
    expect(resolveProvider(storage, project(), 'serpapi')).toBe('serpapi')
  })

  test('auto is cloro once a cloro key the project may use is on', async () => {
    const { storage, checkDeps } = await seeded()
    addCloroKey(storage, checkDeps.secrets)
    expect(cloroAvailable(storage, project())).toBe(true)
    expect(resolveProvider(storage, project(), 'auto')).toBe('cloro')
    expect(resolveProvider(storage, project(), 'serpapi')).toBe('serpapi')
  })

  test('a cloro key switched off, or kept for another project, does not count', async () => {
    const { storage, checkDeps } = await seeded()
    addCloroKey(storage, checkDeps.secrets)
    const key = getApiKey(storage.db, 'cloro-1')
    if (key === null) throw new Error('cloro key missing')
    updateApiKey(storage.db, { ...key, on: false })
    expect(cloroAvailable(storage, project())).toBe(false)
    expect(resolveProvider(storage, project(), 'auto')).toBe('serpapi')
    updateApiKey(storage.db, { ...key, on: true, projectIds: ['proj-other'] })
    expect(cloroAvailable(storage, project())).toBe(false)
  })

  test("a dedicated SerpApi key does not hide the project's cloro keys", async () => {
    const { storage, checkDeps } = await seeded()
    addCloroKey(storage, checkDeps.secrets)
    expect(cloroAvailable(storage, project({ dedicatedKeyId: 'key-1' }))).toBe(true)
  })
})

describe('selectedEngines', () => {
  test("a page's own engines win over the project's; clearing them follows the project", async () => {
    const { projectDb } = await seeded()
    expect(selectedEngines(projectDb, 'page-1')).toEqual(['google_aio'])
    saveEngineSettings(projectDb, { engines: ['google_aio', 'chatgpt'] }, NOW)
    expect(selectedEngines(projectDb, 'page-1')).toEqual(['google_aio', 'chatgpt'])
    savePageEngines(projectDb, 'page-1', ['gemini'], NOW)
    expect(selectedEngines(projectDb, 'page-1')).toEqual(['gemini'])
    savePageEngines(projectDb, 'page-1', null, NOW)
    expect(selectedEngines(projectDb, 'page-1')).toEqual(['google_aio', 'chatgpt'])
  })
})

describe('keyPricing', () => {
  test('cloro keys price at Lite; SerpApi keys at their plan, else Developer', async () => {
    const { storage, checkDeps } = await seeded()
    addCloroKey(storage, checkDeps.secrets)
    const serp = getApiKey(storage.db, 'key-1')
    if (serp === null) throw new Error('SerpApi key missing')
    const pricing = keyPricing(storage)
    expect(pricing.planFor('cloro-1', 'cloro')).toEqual(providerPlan('cloro', 'lite'))
    expect(pricing.planFor('cloro-1', 'cloro')).toMatchObject({ usd: 30, units: 37_500 })
    expect(pricing.planFor(null, 'cloro')).toMatchObject({ id: 'lite' })
    expect(pricing.planFor('key-1', 'serpapi')).toMatchObject({ id: 'developer' })
    expect(pricing.planFor('missing', 'serpapi')).toMatchObject({ id: 'developer' })

    updateApiKey(storage.db, {
      ...serp,
      serpapiUsage: { used: 10, planLimit: 15_000, plan: 'Production' }
    })
    expect(keyPricing(storage).planFor('key-1', 'serpapi')).toMatchObject({ id: 'production' })
    // A plan name the user typed wins over the one SerpApi reported.
    updateApiKey(storage.db, {
      ...serp,
      plan: 'Starter',
      serpapiUsage: { used: 10, planLimit: 15_000, plan: 'Production' }
    })
    expect(keyPricing(storage).planFor('key-1', 'serpapi')).toMatchObject({ id: 'starter' })
  })
})
