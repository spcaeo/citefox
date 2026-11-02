import { describe, expect, test } from 'vitest'
import {
  ANSWER_ENGINE_IDS,
  CLORO_CREDITS,
  ENGINE_IDS,
  engineOnProvider,
  isAnswerEngineId,
  isEngineId,
  microsToUsd,
  normaliseEngines,
  providerPlan,
  unitsCostMicros
} from './engines'

describe('normaliseEngines', () => {
  test('returns display order, drops repeats and unknown values', () => {
    expect(
      normaliseEngines(['copilot', 'chatgpt', 'copilot', 'bing', 42, null, 'google_aio'])
    ).toEqual(['google_aio', 'chatgpt', 'copilot'])
  })

  test('keeps every engine in ENGINE_IDS order', () => {
    expect(normaliseEngines([...ENGINE_IDS].reverse())).toEqual([...ENGINE_IDS])
    expect(ENGINE_IDS).toEqual([
      'google_aio',
      'chatgpt',
      'perplexity',
      'google_ai_mode',
      'gemini',
      'copilot'
    ])
  })

  test('is case-sensitive and gives an empty list for nothing usable', () => {
    expect(normaliseEngines(['ChatGPT', 'GOOGLE_AIO'])).toEqual([])
    expect(normaliseEngines([])).toEqual([])
  })
})

describe('engine guards', () => {
  test('answer engines are every engine but Google AI Overview', () => {
    expect(isEngineId('gemini')).toBe(true)
    expect(isEngineId('bard')).toBe(false)
    expect(isAnswerEngineId('google_aio')).toBe(false)
    expect(ANSWER_ENGINE_IDS.every((engine) => isAnswerEngineId(engine))).toBe(true)
  })

  test('SerpApi reaches only Google AI Overview; cloro reaches all six', () => {
    for (const engine of ENGINE_IDS) {
      expect(engineOnProvider(engine, 'cloro')).toBe(true)
      expect(engineOnProvider(engine, 'serpapi')).toBe(engine === 'google_aio')
    }
  })
})

describe('CLORO_CREDITS', () => {
  test('sync prices per engine', () => {
    expect(CLORO_CREDITS).toEqual({
      google_aio: 7,
      chatgpt: 7,
      perplexity: 6,
      google_ai_mode: 6,
      gemini: 6,
      copilot: 7
    })
  })
})

describe('providerPlan', () => {
  test('matches SerpApi plan names in any case, with or without "plan"', () => {
    expect(providerPlan('serpapi', 'Developer').id).toBe('developer')
    expect(providerPlan('serpapi', 'developer plan').id).toBe('developer')
    expect(providerPlan('serpapi', '  Production').id).toBe('production')
    expect(providerPlan('serpapi', 'Big Data').id).toBe('big data')
    expect(providerPlan('serpapi', 'Big Data Plan').id).toBe('big data')
    expect(providerPlan('serpapi', 'Free').usd).toBe(0)
  })

  test('a "plan" suffix followed by spaces still matches', () => {
    expect(providerPlan('serpapi', 'Production Plan ').id).toBe('production')
    expect(providerPlan('serpapi', 'starter plan\n').id).toBe('starter')
  })

  test('unknown or missing SerpApi names fall back to Developer', () => {
    expect(providerPlan('serpapi', 'Enterprise').id).toBe('developer')
    expect(providerPlan('serpapi', null).id).toBe('developer')
    expect(providerPlan('serpapi', '').id).toBe('developer')
  })

  test('cloro plans default to Lite', () => {
    expect(providerPlan('cloro', 'Lite')).toEqual({
      id: 'lite',
      label: 'Lite',
      usd: 30,
      units: 37_500
    })
    expect(providerPlan('cloro', 'lite plan').id).toBe('lite')
    expect(providerPlan('cloro', 'Pro').id).toBe('lite')
    expect(providerPlan('cloro', null).id).toBe('lite')
  })
})

describe('unitsCostMicros', () => {
  test('7 cloro credits on Lite ($30 for 37,500) is 5,600 micro-dollars', () => {
    expect(unitsCostMicros(7, providerPlan('cloro', 'Lite'))).toBe(5600)
    expect(microsToUsd(5600)).toBeCloseTo(0.0056, 10)
  })

  test('6 cloro credits on Lite is 4,800 micro-dollars', () => {
    expect(unitsCostMicros(6, providerPlan('cloro', null))).toBe(4800)
  })

  test('one SerpApi search on Developer ($75 for 5,000) is 15,000 micro-dollars', () => {
    expect(unitsCostMicros(1, providerPlan('serpapi', 'Developer'))).toBe(15_000)
    expect(unitsCostMicros(3, providerPlan('serpapi', 'developer plan'))).toBe(45_000)
  })

  test('rounds to the nearest micro', () => {
    // Starter: $25 / 1,000 = 25,000 micros a search; Production: $150 / 15,000 = 10,000.
    expect(unitsCostMicros(1, providerPlan('serpapi', 'Starter'))).toBe(25_000)
    expect(unitsCostMicros(1, providerPlan('serpapi', 'Production'))).toBe(10_000)
    // Big Data: $275 / 30,000 = 9,166.67 micros a search.
    expect(unitsCostMicros(1, providerPlan('serpapi', 'Big Data'))).toBe(9167)
  })

  test('zero or negative units, a free plan and an empty plan cost nothing', () => {
    const lite = providerPlan('cloro', 'Lite')
    expect(unitsCostMicros(0, lite)).toBe(0)
    expect(unitsCostMicros(-3, lite)).toBe(0)
    expect(unitsCostMicros(10, providerPlan('serpapi', 'Free'))).toBe(0)
    expect(unitsCostMicros(10, { id: 'x', label: 'X', usd: 10, units: 0 })).toBe(0)
  })
})
