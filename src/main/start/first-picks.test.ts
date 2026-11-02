import { describe, expect, test } from 'vitest'
import { rulePage, type StartPageRow } from './candidates'
import { withSeedReasons } from './first-picks'
import { isCountOnly, parseStartReply } from './prompt'
import type { RankedPage } from './rank'

const row = (path: string): StartPageRow => ({
  id: `page-${path}`,
  url: `https://textbolt.com${path}`,
  title: null,
  tracked: false
})
const ranked = (path: string, productId: string | null, facts: string[]): RankedPage => ({
  page: row(path),
  kind: 'use_case',
  score: 40,
  productId,
  facts,
  rival: null
})
const PICKS = [
  ranked('/use-case/performance-monitoring-text-alerts/', 'prod-email', [
    '18 saved competitors sell Email-to-SMS gateway too'
  ]),
  ranked('/pricing/', null, ['Pricing page'])
]
const SEEDS = [
  {
    text: 'Replacing carrier email-to-text gateway that stopped working',
    productId: 'prod-email',
    evidence: '/migration/att/',
    caution: null
  },
  {
    text: 'Getting server monitoring alerts texted to on-call phones',
    productId: 'prod-email',
    evidence: '/use-case/server-monitoring/',
    caution: null
  }
]

describe('first-run page reasons name a buyer situation', () => {
  test('a reason that is only a count is not an explanation', () => {
    expect(isCountOnly('18 saved competitors sell Email-to-SMS gateway too')).toBe(true)
    expect(isCountOnly('73 of your pages cover it, for Email-to-SMS gateway.')).toBe(true)
    expect(isCountOnly('IT teams whose monitoring tool only sends email ask for texts.')).toBe(
      false
    )
    const parsed = parseStartReply(
      {
        pages: [
          {
            path: '/use-case/performance-monitoring-text-alerts/',
            reason: '18 saved competitors sell Email-to-SMS gateway too',
            evidence: '18 saved competitors sell Email-to-SMS gateway too'
          }
        ]
      },
      PICKS,
      []
    )
    expect(parsed.explained).toBe(0)
  })

  test('an unexplained pick takes the seed situation its path shares most words with', () => {
    const pages = PICKS.map((pick) => rulePage(pick.page, [], undefined, pick.facts.join(' · ')))
    const [alerts, pricing] = withSeedReasons(pages, new Set(), PICKS, SEEDS)
    expect(alerts?.reason).toBe(
      'Buyers getting server monitoring alerts texted to on-call phones ask AI Overviews what to do, and this page can answer them.'
    )
    // The count fact was the only evidence: the seed's own evidence replaces it.
    expect(alerts?.evidence).toBe('/use-case/server-monitoring/')
    // No seed word in /pricing/ and no product: the page keeps its own line.
    expect(pricing?.reason).toBe(pages[1]?.reason)
  })

  test('a pick Claude explained keeps its reason', () => {
    const pages = PICKS.map((pick) =>
      rulePage(pick.page, [], 'IT teams ask how to get slowdown alerts as texts.', 'Use case page')
    )
    const explained = new Set(PICKS.map((pick) => pick.page.url))
    expect(withSeedReasons(pages, explained, PICKS, SEEDS)).toEqual(pages)
  })
})
