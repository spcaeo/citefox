import { describe, expect, it } from 'vitest'
import type { SentimentCheckPoint } from '@shared/domain'
import { answerRows } from '@shared/sentiment-metrics'
import { SENTIMENT_CLAIMS, SENTIMENT_OVERVIEWS, sentimentView } from '../fixtures'
import {
  brandPromptProblem,
  changeLabel,
  estimateLabel,
  filterAnswers,
  filterBySource,
  layoutTrend,
  netBand,
  readingLine,
  sortAnswers
} from './model'

function point(
  checkedAt: string,
  positive: number,
  neutral: number,
  negative: number
): SentimentCheckPoint {
  return {
    runId: checkedAt,
    checkedAt,
    overviews: 1,
    overviewsRead: 1,
    positive,
    neutral,
    negative
  }
}

describe('sentiment model', () => {
  it('filters overviews and claims by question source', () => {
    const brand = filterBySource(sentimentView(), 'brand')
    expect(brand.overviews.every((overview) => overview.source === 'brand')).toBe(true)
    expect(brand.claims.every((claim) => claim.source === 'brand')).toBe(true)
    expect(filterBySource(sentimentView(), 'all').claims).toHaveLength(SENTIMENT_CLAIMS.length)
  })

  it('bands net values like the legend', () => {
    expect([60, 25, 0, -25, -60, null].map(netBand)).toEqual([
      'pos2',
      'pos1',
      'zero',
      'neg1',
      'neg2',
      'none'
    ])
  })

  it('labels the change since the previous check', () => {
    const trend = [
      point('2026-10-05T12:00:00.000Z', 12, 6, 4),
      point('2026-10-19T12:00:00.000Z', 10, 4, 5)
    ]
    expect(changeLabel(26, trend)).toMatch(/^−10 since Oct 5, \d/)
    expect(changeLabel(36, trend)).toMatch(/^No change since Oct 5, \d/)
    expect(changeLabel(26, trend.slice(1))).toBe('First check')
    expect(changeLabel(null, trend)).toBe('Change: not enough data')
  })

  it('spaces checks by real time', () => {
    const points = layoutTrend(
      [
        point('2026-10-01T00:00:00.000Z', 5, 0, 0),
        point('2026-10-04T00:00:00.000Z', 5, 0, 5),
        point('2026-10-31T00:00:00.000Z', 1, 0, 0)
      ],
      { left: 0, right: 300, top: 0, bottom: 200 }
    )
    expect(points.map((item) => Math.round(item.x))).toEqual([0, 30, 300])
    expect(points.map((item) => item.y)).toEqual([0, 100, 100])
    expect(points[2]?.net).toBeNull()
  })

  it('writes the estimate and reading lines', () => {
    expect(estimateLabel({ prompts: 5, markets: 4, minSearches: 20, maxSearches: 40 })).toBe(
      '5 questions × 4 markets = 20–40 searches per check'
    )
    expect(estimateLabel({ prompts: 7, markets: 2, minSearches: 7, maxSearches: 14 })).toBe(
      '7 questions across 2 markets = 7–14 searches per check'
    )
    expect(readingLine({ pending: 0, failed: 0, running: false })).toBeNull()
    expect(readingLine({ pending: 1, failed: 0, running: false })).toBe(
      '1 overview not read yet. Re-read saved overviews to read them. No new searches.'
    )
    expect(readingLine({ pending: 0, failed: 2, running: false })).toBe(
      '2 overviews could not be read. Re-read saved overviews to try again.'
    )
  })

  it('requires brand questions to name the brand', () => {
    const ok = { kind: 'review' as const, language: 'en', text: 'TextBolt reviews' }
    expect(brandPromptProblem([ok], ['TextBolt'])).toBeNull()
    expect(brandPromptProblem([], ['TextBolt'])).toBe('Add at least one brand question.')
    expect(brandPromptProblem([{ ...ok, text: 'sms reviews' }], ['TextBolt'])).toContain(
      "doesn't name TextBolt"
    )
    expect(brandPromptProblem([ok, ok], ['TextBolt'])).toBe(
      'Two brand questions are the same. Remove one.'
    )
  })

  it('filters and sorts answers', () => {
    const rows = answerRows(SENTIMENT_OVERVIEWS, SENTIMENT_CLAIMS, 'TextBolt')
    expect(filterAnswers(rows, 'pricing', 'all').length).toBeGreaterThan(0)
    const negative = filterAnswers(rows, '', 'negative')
    expect(negative.every((row) => row.tone === 'negative')).toBe(true)
    const byRank = sortAnswers(rows, [{ key: 'rank', dir: 'asc' }])
    expect(byRank[0]?.rank).toBe(1)
  })
})
