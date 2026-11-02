import { describe, expect, it } from 'vitest'
import { providerPlan, type ApiKeyMetadata, type CloroCredits } from '@shared/domain'
import {
  checkCost,
  checksPerMonth,
  dailyCostNote,
  firstCheckLine,
  fitMix,
  monthlyLine,
  promptCost,
  searchBalance
} from './engineCost'

describe('the step 7 cost line', () => {
  it('matches the mock-up: 10 prompts × 2 answers every 14 days ≈ 280 credits, about $0.22', () => {
    const cost = checkCost({
      provider: 'cloro',
      engines: ['google_aio', 'chatgpt'],
      options: [],
      questions: 10,
      everyDays: 14,
      plan: providerPlan('cloro', null)
    })
    expect(monthlyLine(cost, 14)).toBe(
      '10 prompts × 2 answers every 14 days ≈ 280 credits a month, about $0.22'
    )
    expect(firstCheckLine(cost)).toBe('First check: 10 prompts × 2 answers · 140 credits')
  })

  it('counts searches for Google AI Overview only', () => {
    const cost = checkCost({
      provider: 'serpapi',
      engines: ['google_aio', 'chatgpt'],
      options: [],
      questions: 10,
      everyDays: 30,
      plan: providerPlan('serpapi', null)
    })
    expect(firstCheckLine(cost)).toBe('First check: 10 prompts × 1 answer · 10 searches')
    expect(checksPerMonth(60)).toBe(0.5)
  })

  it('every day counts 30 checks a month and says so; every 7 days counts 4', () => {
    expect(checksPerMonth(1)).toBe(30)
    expect(checksPerMonth(7)).toBe(4)
    expect(checksPerMonth(0)).toBe(0)
    const cost = checkCost({
      provider: 'cloro',
      engines: ['google_aio'],
      options: [],
      questions: 10,
      everyDays: 1,
      plan: providerPlan('cloro', null)
    })
    expect(cost.perCheck).toBe(70)
    expect(cost.perMonth).toBe(2100)
    expect(monthlyLine(cost, 1)).toMatch(
      /^10 prompts × 1 answer every day ≈ 2,100 credits a month, about \$/
    )
    expect(dailyCostNote(1)).toBe(
      'Every day runs about 30 checks a month, about 7 times what every 7 days uses.'
    )
    expect(dailyCostNote(7)).toBeNull()
    expect(dailyCostNote(0)).toBeNull()
  })
})

function key(extra: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'k1',
    provider: 'cloro',
    name: 'cloro',
    on: true,
    state: 'ok',
    cloroCredits: null,
    serpapiUsage: null,
    ...extra
  } as ApiKeyMetadata
}

describe('step 8 credit check', () => {
  it('prices one prompt on the ticked engines', () => {
    expect(promptCost('cloro', ['google_aio', 'chatgpt'], [])).toBe(14)
    expect(promptCost('serpapi', ['google_aio', 'chatgpt'], [])).toBe(1)
  })

  it('adds up what the working keys have left, and knows when nobody said', () => {
    const credits = (remaining: number): CloroCredits => ({
      remaining,
      perCycle: null,
      resetsAt: null
    })
    expect(
      searchBalance(
        [
          key({ cloroCredits: credits(85) }),
          key({ id: 'k2', cloroCredits: credits(40) }),
          key({ id: 'k3', on: false, cloroCredits: credits(500) })
        ],
        'cloro'
      )
    ).toBe(125)
    expect(searchBalance([key({})], 'cloro')).toBeNull()
    expect(
      searchBalance(
        [key({ provider: 'serpapi', serpapiUsage: { planLimit: 250, used: 40 } as never })],
        'serpapi'
      )
    ).toBe(210)
  })

  it('scales a mix down, each shape keeping its share', () => {
    expect(fitMix({ search: 4, question: 4, situation: 4 }, 6)).toEqual({
      search: 2,
      question: 2,
      situation: 2
    })
    // 85 credits at 14 a prompt is 6 prompts.
    expect(fitMix({ search: 6, question: 4, situation: 2 }, 85 / 14)).toEqual({
      search: 3,
      question: 2,
      situation: 1
    })
    const fits = { search: 1, question: 1, situation: 1 }
    expect(fitMix(fits, 5)).toBe(fits)
    expect(fitMix(fits, 0)).toEqual({ search: 0, question: 0, situation: 0 })
  })
})
