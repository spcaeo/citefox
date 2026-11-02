import { describe, expect, test } from 'vitest'
import type { ClaimTone, SentimentClaim, SentimentOverview } from './domain'
import {
  answerRows,
  brandMatrix,
  formatNet,
  mentionShares,
  negativeSources,
  netSentiment,
  overviewsNamingBrand,
  ownClaims,
  rankLabel,
  themeRows,
  toneBuckets,
  toneCounts
} from './sentiment-metrics'

function overview(
  id: string,
  brandsNamed: string[],
  readState: SentimentOverview['readState'] = 'read'
): SentimentOverview {
  return {
    id,
    source: 'brand',
    runId: 'run-1',
    marketId: 'mkt-us',
    promptId: `p-${id}`,
    promptLabel: 'Reviews',
    promptText: `prompt ${id}`,
    checkedAt: '2026-10-19T12:00:00.000Z',
    readState,
    brandsNamed,
    reason: `reason ${id}`,
    references: []
  }
}

let next = 0
function claim(
  overviewId: string,
  brand: string,
  tone: ClaimTone,
  theme = 'Pricing',
  url: string | null = null
): SentimentClaim {
  next += 1
  return {
    id: `c-${next}`,
    overviewId,
    runId: 'run-1',
    marketId: 'mkt-us',
    source: 'brand',
    promptId: `p-${overviewId}`,
    brand,
    isOwn: brand === 'TextBolt',
    theme,
    attribute: `attr ${next}`,
    tone,
    sentence: `sentence ${next}`,
    url,
    sourceKind: url === null ? null : 'review',
    factProblem: null
  }
}

const OVERVIEWS = [
  overview('o1', ['TextBolt', 'SimpleTexting']),
  overview('o2', ['SimpleTexting', 'TextBolt', 'Twilio']),
  overview('o3', []),
  overview('o4', ['TextBolt'], 'failed')
]
const CLAIMS = [
  claim('o1', 'TextBolt', 'positive', 'Ease of setup', 'https://g2.com/a'),
  claim('o1', 'TextBolt', 'negative', 'Pricing', 'https://g2.com/a'),
  claim('o1', 'SimpleTexting', 'positive', 'Replies'),
  claim('o2', 'TextBolt', 'neutral', 'Pricing'),
  claim('o2', 'TextBolt', 'negative', 'Support', 'https://reddit.com/r/x'),
  claim('o2', 'TextBolt', 'positive', 'Ease of setup'),
  claim('o2', 'Twilio', 'negative', 'Ease of setup'),
  claim('o3', 'Twilio', 'neutral', 'Pricing')
]

describe('net sentiment (FR-16.3)', () => {
  test('is (positive − negative) ÷ all × 100, and not enough data below 5 claims', () => {
    expect(netSentiment({ positive: 3, neutral: 1, negative: 1, total: 5 })).toBe(40)
    expect(netSentiment({ positive: 3, neutral: 0, negative: 1, total: 4 })).toBeNull()
    expect(formatNet(null)).toBe('Not enough data')
    expect(formatNet(-20)).toBe('−20')
    expect(formatNet(36)).toBe('+36')
    const own = toneCounts(ownClaims(CLAIMS))
    expect(own).toEqual({ positive: 2, neutral: 1, negative: 2, total: 5 })
    expect(netSentiment(own)).toBe(0)
  })
})

describe('every split adds up to its total (NFR-14)', () => {
  test('tone buckets', () => {
    const own = ownClaims(CLAIMS)
    const buckets = toneBuckets(own)
    const sum = buckets.positive.count + buckets.neutral.count + buckets.negative.count
    expect(sum).toBe(own.length)
    for (const bucket of Object.values(buckets)) expect(bucket.claimIds).toHaveLength(bucket.count)
  })

  test('share of mentions counts read overviews per brand', () => {
    const shares = mentionShares(OVERVIEWS, CLAIMS, 'TextBolt', ['SimpleTexting', 'Twilio'])
    expect(shares.map((row) => [row.brand, row.mentions])).toEqual([
      ['TextBolt', 2],
      ['SimpleTexting', 2],
      ['Twilio', 2]
    ])
    for (const row of shares) expect(row.overviewIds).toHaveLength(row.mentions)
    // Mentions are the unit; rounded percentages are labels only.
    expect(shares.reduce((sum, row) => sum + row.mentions, 0)).toBe(6)
    expect(shares.map((row) => row.share)).toEqual([33, 33, 33])
    expect(overviewsNamingBrand(OVERVIEWS, CLAIMS, 'TextBolt').map((o) => o.id)).toEqual([
      'o1',
      'o2'
    ])
  })

  test('themes, the brand matrix, and negative sources', () => {
    const own = ownClaims(CLAIMS)
    const themes = themeRows(own)
    expect(themes.reduce((sum, row) => sum + row.counts.total, 0)).toBe(own.length)
    expect(themes[0]).toMatchObject({ theme: 'Ease of setup', net: 100 })
    expect(themes.find((row) => row.theme === 'Support')?.net).toBeNull()

    const matrix = brandMatrix(CLAIMS, 'TextBolt', ['SimpleTexting', 'Twilio'])
    expect(matrix.totals.map((cell) => cell.count)).toEqual([5, 1, 2])
    const ease = matrix.rows.find((row) => row.theme === 'Ease of setup')
    expect(ease?.cells.map((cell) => cell.net)).toEqual([100, null, null])
    for (const row of matrix.rows) {
      for (const cell of row.cells) expect(cell.claimIds).toHaveLength(cell.count)
    }

    const sources = negativeSources(CLAIMS)
    expect(sources.reduce((sum, row) => sum + row.claimIds.length, 0)).toBe(2)
    expect(sources.map((row) => row.url).sort()).toEqual([
      'https://g2.com/a',
      'https://reddit.com/r/x'
    ])
    expect(sources[0]?.advice).toContain('review')
  })
})

describe('answer by answer (FR-16.7)', () => {
  test('ranks the brand among the brands named and keeps the reason', () => {
    const rows = answerRows(OVERVIEWS, CLAIMS, 'TextBolt')
    expect(rows.map((row) => [row.overviewId, row.rank, row.brandsNamed, row.tone])).toEqual([
      ['o1', 1, 2, 'neutral'],
      ['o2', 2, 3, 'neutral']
    ])
    expect(rankLabel(rows[1] ?? { rank: null, brandsNamed: 0 })).toBe('#2 of 3 brands named')
    expect(rankLabel({ rank: null, brandsNamed: 1 })).toBe('Named')
    expect(rows[0]?.reason).toBe('reason o1')
  })
})
