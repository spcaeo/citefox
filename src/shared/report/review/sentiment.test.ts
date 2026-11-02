import { describe, expect, it } from 'vitest'
import { buildReport } from './build'
import { EMPTY_EXTRAS, type BrandClaim } from './extras'
import { sampleContext, sampleMetrics } from './sample.test-helper'
import { toneSplit } from './sentiment'

/** How AI talks about you: the What changed movement card (REPORT-SPEC §5 Reputation). */

const claim = (polarity: BrandClaim['polarity'], sentence: string): BrandClaim => ({
  polarity,
  sentence,
  theme: 'Pricing'
})

describe('How AI talks about you', () => {
  it('says not enough data below 5 claims, else the net sentiment', () => {
    expect(toneSplit([claim('positive', 'a')]).net).toBeNull()
    const five = [
      claim('positive', 'a'),
      claim('positive', 'b'),
      claim('positive', 'c'),
      claim('neutral', 'd'),
      claim('negative', 'e')
    ]
    expect(toneSplit(five)).toMatchObject({ positive: 3, neutral: 1, negative: 1, net: 40 })
  })

  it('splits the tone before → now and finds new and gone negative claims', () => {
    const report = buildReport(sampleMetrics({ engine: 'google_aio' }), sampleContext('changed'), {
      ...EMPTY_EXTRAS,
      claims: {
        'google_aio:c1:q12': [
          claim('negative', 'TextBolt is expensive.'),
          claim('positive', 'Fast.')
        ],
        'google_aio:c3:q12': [claim('positive', 'Fast.'), claim('positive', 'Cheap.')],
        'google_aio:c3:q4': [claim('negative', 'TextBolt has no free plan.')],
        // Sep 30 is not an end of this window: never counted.
        'google_aio:c2:q4': [claim('negative', 'Ignored.')]
      }
    })
    const s = report.whatChanged.sentiment
    expect(s?.before).toMatchObject({ positive: 1, negative: 1, total: 2, net: null })
    expect(s?.now).toMatchObject({ positive: 2, negative: 1, total: 3 })
    expect(s?.newlyNegative.n).toBe(1)
    expect(s?.newlyNegativeClaims[0]).toMatchObject({ sentence: 'TextBolt has no free plan.' })
    expect(report.drills[s?.newlyNegative.drill ?? '']?.ids).toEqual(['google_aio:c3:q4'])
    expect(s?.goneNegative.n).toBe(1)
    expect(s?.goneNegativeClaims[0]?.sentence).toBe('TextBolt is expensive.')
  })

  it('is null without claims', () => {
    const report = buildReport(sampleMetrics(), sampleContext('changed'), EMPTY_EXTRAS)
    expect(report.whatChanged.sentiment).toBeNull()
  })
})
