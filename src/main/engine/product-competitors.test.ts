import { describe, expect, test } from 'vitest'
import { parseJson } from './assist'
import {
  guardProductCompetitors,
  httpUrl,
  marketWords,
  parseProductCompetitors,
  productCompetitorPrompt,
  type DomainCheckCache
} from './product-competitors'

/** Docs/FEEDBACK.md batch 2 row 5: the per-product competitor question and its guard. */

const DNS = {
  async lookup(hostname: string): Promise<string[]> {
    if (hostname.endsWith('.invalid')) throw new Error('ENOTFOUND')
    return ['93.184.216.34']
  }
}

function guard(
  found: unknown,
  notCompetitors: readonly string[] = []
): ReturnType<typeof guardProductCompetitors> {
  const parsed = parseProductCompetitors(found)
  if (parsed === null) throw new Error('did not parse')
  let id = 0
  const cache: DomainCheckCache = new Map()
  return guardProductCompetitors({
    found: parsed,
    productId: 'prod-1',
    ownDomain: 'textbolt.com',
    brandNames: ['TextBolt'],
    notCompetitors,
    dns: DNS,
    createId: () => `id-${(id += 1)}`,
    cache
  })
}

describe('product competitors', () => {
  test('the prompt asks the owner’s question for the product and the market', () => {
    const prompt = productCompetitorPrompt({
      domain: 'textbolt.com',
      product: { name: 'email-to-SMS gateway', job: 'Emails become texts.', buyer: 'US teams' },
      summary: 'TextBolt sells an email-to-SMS gateway.',
      market: { country: 'US', language: 'en' },
      comparedWith: ['SimpleTexting', 'Textedly']
    })
    expect(prompt.split('\n')[0]).toBe('Assist: project.productCompetitors')
    expect(prompt).toContain(
      "What are the competitors of textbolt.com's email-to-SMS gateway that do exactly what it does, for buyers in United States (English)?"
    )
    expect(prompt).toContain('Who buys it: US teams')
    expect(prompt).toContain('Its own pages compare it with: SimpleTexting, Textedly.')
    expect(prompt).toContain('- direct:')
    expect(prompt).toContain('- partial:')
    expect(prompt).toContain('Never list textbolt.com itself.')
    expect(marketWords({ country: 'gb', language: 'en' })).toBe('United Kingdom (English)')
  })

  test('the reply is parsed strictly; bad sources and empty prices are dropped', () => {
    expect(parseProductCompetitors({ direct: [] })).toBeNull()
    expect(parseProductCompetitors({ direct: [{ name: 'X' }], partial: [] })).toBeNull()
    expect(
      parseProductCompetitors({ direct: [{ name: 'X', why: 'Y', domain: 3 }], partial: [] })
    ).toBeNull()
    const parsed = parseProductCompetitors({
      direct: [
        {
          name: 'TXTImpact',
          domain: 'txtimpact.com',
          why: 'Email to SMS.',
          startingPrice: 'Not listed',
          sources: [
            { url: 'https://txtimpact.com/pricing', biased: true },
            { url: 'https://txtimpact.com/pricing', biased: true },
            'https://www.g2.com/products/txtimpact',
            { url: 'javascript:alert(1)', biased: false },
            { url: 'https://user:pass@example.com/', biased: false }
          ]
        }
      ],
      partial: []
    })
    expect(parsed?.direct[0]).toEqual({
      name: 'TXTImpact',
      domain: 'txtimpact.com',
      why: 'Email to SMS.',
      startingPrice: null,
      sources: [
        { url: 'https://txtimpact.com/pricing', biased: true },
        { url: 'https://www.g2.com/products/txtimpact', biased: false }
      ]
    })
    expect(httpUrl('mailto:a@b.com')).toBeNull()
  })

  test('the guard drops the business, carriers and switch-from names, and verifies domains', async () => {
    const result = await guard(
      {
        direct: [
          { name: 'TextBolt', domain: 'textbolt.com', why: 'Itself.' },
          { name: 'Verizon', domain: 'verizon.com', why: 'A carrier.' },
          { name: 'AT&T email-to-text', domain: null, why: 'The old gateway.' },
          {
            name: 'Notifyre',
            domain: 'notifyre.com',
            why: 'Email to SMS for US teams. I could not confirm whether replies return.',
            startingPrice: '$0.02/text',
            sources: [{ url: 'https://textbolt.com/compare', biased: false }]
          },
          { name: 'Notifyre', domain: 'notifyre.com', why: 'Twice.' }
        ],
        partial: [
          { name: 'Ghost', domain: 'ghost.invalid', why: 'Unverifiable.' },
          { name: 'NoDomain Co', domain: null, why: 'No domain given.' }
        ]
      },
      ['AT&T email-to-text gateway']
    )
    expect(
      result.competitors.map((item) => [
        item.name,
        item.domain,
        item.domainSource,
        item.tier,
        item.checkDomain
      ])
    ).toEqual([
      ['Notifyre', 'notifyre.com', 'search', 'direct', false],
      ['Ghost', null, null, 'partial', true],
      ['NoDomain Co', null, null, 'partial', false]
    ])
    expect(result.competitors[0]).toMatchObject({
      product: 'prod-1',
      reason: 'Email to SMS for US teams.',
      startingPrice: '$0.02/text',
      sources: [{ url: 'https://textbolt.com/compare', biased: true }]
    })
    expect(result.dropped.map((item) => item.name)).toEqual([
      'TextBolt',
      'Verizon',
      'AT&T email-to-text'
    ])
  })

  test('a web-search reply wrapped in prose or a fence still reads as JSON', () => {
    expect(parseJson('Here is what I found:\n```json\n{"direct":[],"partial":[]}\n```')).toEqual({
      direct: [],
      partial: []
    })
    expect(parseJson('I searched. {"direct": [], "partial": []} Done.')).toEqual({
      direct: [],
      partial: []
    })
    expect(parseJson('no json here')).toBeNull()
  })
})
