import type { CheckProgress } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { listStoredCheckSteps } from '../../storage/check-records'
import { addPageMarket } from '../../storage/pages'
import { insertMarket } from '../../storage/project-profile'
import { closeSeeds, envelope, NOW, seed } from './checks.test-helper'
import { wordingFor, type MarketPlan, type PromptPlan } from './plan'

afterEach(() => {
  closeSeeds()
})

/** FR-8.6: each market searches its own wording, never another language's. */
describe('market wording', () => {
  test('borrows same-language wording, skips other languages, and still reaches the total', async () => {
    const searched: Array<{ q: string | null; hl: string | null; gl: string | null }> = []
    const progress: CheckProgress[] = []
    const { handlers, projectDb } = await seed({
      progress,
      http(request) {
        const url = new URL(request.url)
        searched.push({
          q: url.searchParams.get('q'),
          hl: url.searchParams.get('hl'),
          gl: url.searchParams.get('gl')
        })
        return envelope('google-ai-overview.json')
      }
    })
    for (const market of [
      { id: 'mkt-gb', country: 'GB', language: 'en' },
      { id: 'mkt-mx', country: 'MX', language: 'es' }
    ]) {
      insertMarket(projectDb, {
        ...market,
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      })
      addPageMarket(projectDb, {
        pageId: 'page-1',
        marketId: market.id,
        addedAt: NOW,
        baselineRunId: null
      })
    }
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    expect(job.total).toBe(3)
    expect(job.done).toBe(3)
    expect(
      job.markets.map((market) => [market.marketId, market.done, market.state]).sort()
    ).toEqual([
      ['mkt-gb', 1, 'ok'],
      ['mkt-mx', 1, 'ok'],
      ['mkt-us', 1, 'ok']
    ])
    expect(searched).toHaveLength(2)
    expect(searched).toEqual(
      expect.arrayContaining([
        { q: 'How do I alert the crew?', hl: 'en', gl: 'us' },
        { q: 'How do I alert the crew?', hl: 'en', gl: 'uk' }
      ])
    )
    const skipped = listStoredCheckSteps(projectDb, job.id).find(
      (step) => step.marketId === 'mkt-mx'
    )
    expect(skipped).toMatchObject({ phase: 'analysis', state: 'warning' })
    expect(skipped?.detail).toMatch(/^Skipped/)
    expect(progress.at(-1)?.done).toBe(3)
  })
})

describe('wordingFor', () => {
  const market = (id: string, hl: string): MarketPlan => ({
    id,
    gl: 'us',
    hl,
    location: null,
    device: 'desktop',
    addedAt: NOW
  })
  const prompt: PromptPlan = {
    id: 'p',
    position: 1,
    label: 'p',
    source: 'title_meta_h1',
    intentStage: 'problem',
    textByMarket: new Map([
      ['mkt-ca', 'Canadian wording'],
      ['mkt-us', 'US wording']
    ]),
    variants: [
      { marketId: 'mkt-ca', language: 'en', text: 'Canadian wording' },
      { marketId: 'mkt-us', language: 'EN', text: 'US wording' },
      { marketId: 'mkt-fr', language: 'fr', text: '' }
    ]
  }

  test('prefers the market, then the default market in the same language', () => {
    expect(wordingFor(prompt, market('mkt-ca', 'en'), 'mkt-us')).toBe('Canadian wording')
    expect(wordingFor(prompt, market('mkt-au', 'en'), 'mkt-us')).toBe('US wording')
    expect(wordingFor(prompt, market('mkt-au', 'en'), 'mkt-nz')).toBe('Canadian wording')
  })

  test('returns null rather than another language or blank wording', () => {
    expect(wordingFor(prompt, market('mkt-mx', 'es'), 'mkt-us')).toBeNull()
    expect(wordingFor(prompt, market('mkt-fr', 'fr'), 'mkt-us')).toBeNull()
  })
})
