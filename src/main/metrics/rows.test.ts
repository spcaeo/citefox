import { describe, expect, test } from 'vitest'
import type { ScoredReference } from '@shared/topic-scoring'
import { citedDomains, metricRowOf, resultOf, sitePositionsOf, type StoredOutcome } from './rows'

function ref(
  position: number,
  url: string,
  classification: ScoredReference['classification']
): ScoredReference {
  return { position, url, normalizedUrl: url, domain: new URL(url).hostname, classification }
}

const OWN = ref(3, 'https://textbolt.com/pricing', 'own')
const TARGET = ref(2, 'https://textbolt.com/alerts', 'target')
const G2 = ref(1, 'https://www.g2.com/p', 'competitor')

function outcome(
  status: StoredOutcome['status'],
  references: ScoredReference[],
  named = false
): StoredOutcome {
  return { status, references, named }
}

describe('a stored outcome as a metrics row', () => {
  test('the result follows Summary: an own link counts as cited, whatever the status says', () => {
    expect(resultOf(outcome('error', []))).toBe('failed')
    expect(resultOf(outcome('no_aio', []))).toBe('no_answer')
    expect(resultOf(outcome('not_cited', [G2]))).toBe('not_cited')
    expect(resultOf(outcome('brand_mentioned', [G2, OWN]))).toBe('other')
    expect(resultOf(outcome('page_cited', [G2, TARGET, OWN]))).toBe('target')
    expect(resultOf(outcome(null, []))).toBeNull()
  })

  test('a topic question’s target is the page it names', () => {
    const cited = outcome('page_cited', [G2, OWN])
    expect(resultOf(cited, 'https://www.textbolt.com/pricing/')).toBe('target')
    expect(resultOf(cited, 'https://textbolt.com/other')).toBe('other')
    expect(resultOf(cited, null)).toBe('other')
  })

  test('the best own link, other sites as hosts, named only with an answer', () => {
    const row = metricRowOf(outcome('page_cited', [G2, OWN, TARGET], true), {
      id: 'r',
      questionId: 'q',
      text: 'Q',
      engine: 'google_aio',
      marketId: 'us',
      sourceId: 'p',
      sourceKind: 'page',
      checkId: 'c',
      checkedAt: '2026-10-01T00:00:00.000Z'
    })
    expect(row).toMatchObject({
      result: 'target',
      citedUrl: 'https://textbolt.com/alerts',
      position: 2,
      domains: ['g2.com'],
      named: true
    })
    expect(citedDomains(outcome('no_aio', [G2]))).toEqual([])
    expect(
      metricRowOf(outcome('no_aio', [], true), {
        id: 'r',
        questionId: 'q',
        text: 'Q',
        engine: 'chatgpt',
        marketId: 'us',
        sourceId: 'p',
        sourceKind: 'topic',
        checkId: 'c',
        checkedAt: '2026-10-01T00:00:00.000Z'
      })?.named
    ).toBe(false)
  })

  test('each other site keeps its best source position; own links and no answer keep none', () => {
    const second = ref(4, 'https://g2.com/other', 'other')
    expect(sitePositionsOf(outcome('page_cited', [G2, OWN, TARGET, second]))).toEqual({
      'g2.com': 1
    })
    expect(sitePositionsOf(outcome('no_aio', [G2]))).toEqual({})
    const row = metricRowOf(outcome('not_cited', [G2]), {
      id: 'r',
      questionId: 'q',
      text: 'Q',
      engine: 'perplexity',
      marketId: 'us',
      sourceId: 'p',
      sourceKind: 'page',
      checkId: 'c',
      checkedAt: '2026-10-01T00:00:00.000Z'
    })
    expect(row?.sitePositions).toEqual({ 'g2.com': 1 })
  })
})
