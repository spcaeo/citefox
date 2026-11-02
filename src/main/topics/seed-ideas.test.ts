import { describe, expect, test } from 'vitest'
import type { ProjectProduct } from '@shared/domain'
import type { StartPageRow } from '../start/candidates'
import {
  cleanSeeds,
  matchingPages,
  productsAbout,
  productsText,
  rankSeeds,
  seedProblem,
  sitePagesText,
  type SeedIdea
} from './seed-ideas'
import { focusProduct } from './steps-seed'

const BRANDS = ['TextBolt', 'Text Bolt']
const PRODUCTS: ProjectProduct[] = [
  {
    id: 'prod-email',
    name: 'Email to SMS gateway',
    job: 'monitoring alerts and email turned into texts',
    buyer: 'IT teams',
    evidencePath: '/features/email-to-sms/'
  },
  {
    id: 'prod-inbox',
    name: 'Business texting inbox',
    job: 'two-way texting with customers',
    buyer: 'clinics'
  }
]

const seed = (text: string, productId: string | null = null): SeedIdea & { evidence: null } => ({
  text,
  productId,
  evidence: null,
  caution: null
})

const page = (path: string): StartPageRow => ({
  id: path,
  url: `https://textbolt.com${path}`,
  title: null,
  tracked: false
})

describe('cleanSeeds', () => {
  test('keeps situations, drops the brand, labels and repeats, and ties each to a product', () => {
    const kept = cleanSeeds(
      [
        seed('Carrier email-to-text gateways shutting down.', 'prod-email'),
        seed('carrier email to text gateways shutting down', 'prod-email'),
        seed('Is TextBolt worth it for clinics', 'prod-inbox'),
        seed('Email to SMS gateway', 'prod-email'),
        seed('Bulk SMS'),
        seed('Texting patients back from a shared office number', 'prod-unknown')
      ],
      PRODUCTS,
      BRANDS
    )
    expect(kept.map((item) => [item.text, item.productId])).toEqual([
      ['Carrier email-to-text gateways shutting down', 'prod-email'],
      // An unknown id is inferred from the seed's words, as Automatic would.
      ['Texting patients back from a shared office number', 'prod-inbox']
    ])
  })
})

describe('seedProblem', () => {
  test('names labels, the brand and long seeds so the one retry can fix them', () => {
    const problem = seedProblem(
      {
        seeds: [
          seed('Email to SMS gateway'),
          seed('TextBolt for alarm alerts on phones'),
          seed(
            'Our facilities team needs every alarm panel alert to reach the right technician on call as a text message right away'
          )
        ],
        segments: [],
        why: null
      },
      3,
      BRANDS,
      PRODUCTS
    )
    expect(problem).toContain('"Email to SMS gateway"')
    expect(problem).toContain('Leave the brand out')
    expect(problem).toContain('Shorten to 4 to 10 words')
  })

  test('a clean reply has no problem', () => {
    expect(
      seedProblem(
        {
          seeds: [
            seed('Carrier email-to-text gateways shutting down', 'prod-email'),
            seed('Getting alarm panel alerts as text messages', 'prod-email')
          ],
          segments: [],
          why: null
        },
        2,
        BRANDS,
        PRODUCTS
      )
    ).toBeNull()
  })
})

describe('ranking seeds by what they have to gain', () => {
  const pages = [
    page('/features/carrier-email-gateway/'),
    page('/alternatives/att-email-gateway-alternative/'),
    page('/use-cases/alarm-monitoring-alerts/'),
    page('/blog/gateway-shutdown-guide/')
  ]

  test('counts site pages that share the seed words', () => {
    expect(matchingPages('Carrier email gateways shutting down', pages)).toBe(2)
    expect(matchingPages('Texting from a shared office number', pages)).toBe(0)
  })

  test('filler words alone do not make a page match', () => {
    const blog = [
      page('/blog/getting-text-alerts-on-your-phone/'),
      page('/blog/sending-alerts-to-phones/'),
      page('/use-cases/server-monitoring-alerts/')
    ]
    expect(matchingPages('Getting server monitoring alerts texted to on-call phones', blog)).toBe(1)
  })

  test('pages to win with and competitors in play can lift a later seed', () => {
    const ranked = rankSeeds(
      [
        seed('Texting patients from a shared office number', 'prod-inbox'),
        seed('Carrier email gateways shutting down', 'prod-email')
      ],
      pages,
      new Set(['prod-email'])
    )
    expect(ranked.map((item) => item.text)).toEqual([
      'Carrier email gateways shutting down',
      'Texting patients from a shared office number'
    ])
    expect(ranked[0]?.pages).toBe(2)
  })

  test("with nothing to tell them apart, Claude's order stands", () => {
    const ranked = rankSeeds(
      [seed('First idea for buyers'), seed('Second idea for buyers')],
      [],
      new Set()
    )
    expect(ranked.map((item) => item.text)).toEqual([
      'First idea for buyers',
      'Second idea for buyers'
    ])
  })
})

describe('prompt inputs built in code', () => {
  test('products with their ids, or how to answer with none', () => {
    expect(productsText(PRODUCTS)).toContain(
      '- prod-email: Email to SMS gateway. Job: monitoring alerts and email turned into texts. Buyer: IT teams.'
    )
    expect(productsText([])).toBe('None saved. Use null for every productId.')
  })

  test('an about line from the saved products', () => {
    expect(productsAbout('textbolt.com', PRODUCTS)).toBe(
      'textbolt.com sells Email to SMS gateway (monitoring alerts and email turned into texts) and Business texting inbox (two-way texting with customers).'
    )
    expect(productsAbout('textbolt.com', [])).toBeNull()
  })

  test('site pages by kind, so seeds can name situations the site already covers', () => {
    const text = sitePagesText([
      page('/use-cases/alarm-monitoring-alerts/'),
      page('/integrations/outlook/'),
      page('/blog/gateway-shutdown-guide/'),
      page('/careers/')
    ])
    expect(text).toContain('Use case pages:\n- /use-cases/alarm-monitoring-alerts/\n')
    expect(text).toContain('Integration pages:')
    expect(text).not.toContain('/careers/')
    expect(sitePagesText([])).toBe('Site pages: not read yet.')
  })
})

describe('focusProduct', () => {
  const seeds = [seed('Texting patients from a shared office number', 'prod-inbox')]

  test('the product picked on the Seed step wins; null means the whole business', () => {
    expect(focusProduct(PRODUCTS, { productId: 'prod-email', seed: '' }, seeds)?.id).toBe(
      'prod-email'
    )
    expect(focusProduct(PRODUCTS, { productId: null, seed: '' }, seeds)).toBeNull()
  })

  test('else the typed seed, else the first suggestion', () => {
    expect(
      focusProduct(PRODUCTS, { seed: 'Monitoring alerts and email that never reach phones' }, seeds)
        ?.id
    ).toBe('prod-email')
    expect(focusProduct(PRODUCTS, { seed: '' }, seeds)?.id).toBe('prod-inbox')
    expect(focusProduct([], { seed: '' }, seeds)).toBeNull()
  })
})
