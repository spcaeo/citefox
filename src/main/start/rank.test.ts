import { describe, expect, test } from 'vitest'
import type { ProjectProduct } from '@shared/domain'
import { textboltSitemapFixture } from '../structure/fixtures/textbolt-sitemaps'
import type { StartPageRow } from './candidates'
import {
  pickStartPages,
  rankKind,
  rankStartPages,
  START_PICK_COUNT,
  type RankSignals
} from './rank'

const PAGES: StartPageRow[] = textboltSitemapFixture('base').pageUrls.map((url, index) => ({
  id: `page-${index}`,
  url,
  title: null,
  tracked: false
}))

const EMAIL: ProjectProduct = {
  id: 'prod-email',
  name: 'Email to SMS gateway',
  job: 'send texts from email',
  buyer: 'small IT teams',
  evidencePath: '/features/email-to-sms/'
}

const SIGNALS: RankSignals = {
  products: [EMAIL],
  competitors: [
    {
      name: 'SimpleTexting',
      domain: 'simpletexting.com',
      productId: 'prod-email',
      tier: 'partial'
    },
    { name: 'Textmagic', domain: 'textmagic.com', productId: 'prod-email', tier: 'direct' },
    { name: 'Twilio', domain: 'twilio.com', productId: null, tier: 'partial' }
  ],
  switchingFrom: ['AT&T email-to-text gateway']
}

describe('rankStartPages', () => {
  const ranked = rankStartPages(PAGES, SIGNALS)

  test('ranks money pages above guides and never ranks a tracked page', () => {
    const at = (kind: string): number => ranked.findIndex((entry) => entry.kind === kind)
    expect(at('pricing')).toBeLessThan(at('guide'))
    expect(at('alternatives')).toBeLessThan(at('guide'))
    const tracked = rankStartPages(
      PAGES.map((page) => ({ ...page, tracked: page.url.includes('/pricing') })),
      SIGNALS
    )
    expect(tracked.some((entry) => entry.page.url.includes('/pricing'))).toBe(false)
  })

  test('a comparison naming a direct competitor of its product beats one naming a partial one', () => {
    const score = (slug: string): number =>
      rankStartPages(
        [{ id: 'a', url: `https://textbolt.com/compare/${slug}/`, title: null, tracked: false }],
        SIGNALS
      )[0]?.score ?? 0
    expect(score('textbolt-vs-textmagic')).toBeGreaterThan(score('textbolt-vs-simpletexting'))
    expect(score('textbolt-vs-simpletexting')).toBeGreaterThan(score('textbolt-vs-unknownco'))
  })

  test('an alternatives page for something buyers leave says so in its facts', () => {
    const [entry] = rankStartPages(
      [
        {
          id: 'a',
          url: 'https://textbolt.com/alternatives/att-email-to-text-alternative/',
          title: null,
          tracked: false
        }
      ],
      SIGNALS
    )
    expect(entry?.facts.join(' ')).toContain('buyers leaving AT&T email-to-text gateway')
  })

  test('the page where the site describes a product carries that product', () => {
    const [entry] = rankStartPages(
      [
        { id: 'a', url: 'https://textbolt.com/features/email-to-sms/', title: null, tracked: false }
      ],
      SIGNALS
    )
    expect(entry?.productId).toBe('prod-email')
    expect(entry?.facts).toContain('where the site describes Email to SMS gateway')
  })
})

describe('rankKind', () => {
  test('a blog post about a rival pricing is a guide; the own pricing page stays pricing', () => {
    expect(rankKind('https://textbolt.com/blog/slicktext-pricing/')).toBe('guide')
    expect(rankKind('https://textbolt.com/pricing/')).toBe('pricing')
    expect(rankKind('https://textbolt.com/plans/pricing-business/')).toBe('pricing')
    expect(rankKind('https://textbolt.com/compare/textbolt-vs-twilio/')).toBe('compare')
  })
})

describe('pickStartPages', () => {
  test('picks a spread of kinds, at most one pricing page', () => {
    const picks = pickStartPages(rankStartPages(PAGES, SIGNALS))
    expect(picks).toHaveLength(START_PICK_COUNT)
    expect(picks.filter((entry) => entry.kind === 'pricing')).toHaveLength(1)
    expect(new Set(picks.map((entry) => entry.kind)).size).toBeGreaterThanOrEqual(3)
  })

  test('tops up to three when the caps leave too few', () => {
    const pricing = ['/pricing/', '/pricing/teams/', '/pricing/enterprise/'].map((path, index) => ({
      id: `p${index}`,
      url: `https://textbolt.com${path}`,
      title: null,
      tracked: false
    }))
    expect(pickStartPages(rankStartPages(pricing, SIGNALS))).toHaveLength(3)
  })
})
