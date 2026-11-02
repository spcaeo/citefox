import { describe, expect, it } from 'vitest'
import { observeOverview, ordinal, times } from './aio-observations'
import { parseAiOverview, type AioOverview } from './aio-overview'
import type { CitationClass, OverviewLens } from './domain'
import koha from './fixtures/aio-overview-koha.json'

const LENS: OverviewLens = {
  brandNames: ['TextBolt'],
  ownDomain: 'textbolt.com',
  includeSubdomains: true,
  productName: 'Email to SMS',
  competitors: [
    { name: 'Twilio', domain: 'twilio.com', tier: 'direct' },
    { name: 'MessageBee', domain: 'uniquelibrary.com', tier: 'direct' },
    { name: 'Patron Point', domain: 'patronpoint.com', tier: 'partial' }
  ]
}

function parsed(value: unknown): AioOverview {
  const overview = parseAiOverview(value)
  if (!overview) throw new Error('no overview')
  return overview
}

const KOHA = parsed(koha)
/** The check stored the TextBolt AT&T post as this page. */
const KOHA_REFERENCES: { url: string; classification: CitationClass }[] = [
  { url: 'https://textbolt.com/blog/att-email-to-text-shutdown/', classification: 'target' },
  { url: 'https://textbolt.com/migration/tmobile2/', classification: 'own' }
]

function overview(paragraphs: { text: string; refs?: number[] }[], urls: string[]): AioOverview {
  return {
    blocks: paragraphs.map((paragraph) => ({
      kind: 'paragraph',
      text: [{ kind: 'text', text: paragraph.text }],
      refs: paragraph.refs ?? []
    })),
    sources: urls.map((url, index) => ({
      index,
      title: null,
      url,
      snippet: null,
      source: null,
      icon: null,
      thumbnail: null
    }))
  }
}

describe('observeOverview on the Koha overview', () => {
  const seen = observeOverview({ overview: KOHA, lens: LENS, references: KOHA_REFERENCES })

  it('finds the one mention, its section and its quoted sentence', () => {
    expect(seen.mentions).toHaveLength(1)
    expect(seen.mentions[0]).toMatchObject({
      section: '3. Middleware Email-to-SMS Gateway (Drop-in Replacement)',
      sentence: 'How it works: You subscribe to a service like TextBolt or .',
      cited: true
    })
    expect(seen.namedNotCited).toEqual([])
  })

  it('lists the own pages in Google’s order, TextBolt first at reference 1', () => {
    expect(seen.sourceCount).toBe(12)
    expect(seen.ownSources.map((source) => [source.index, source.position, source.kind])).toEqual([
      [1, 2, 'this_page'],
      [3, 4, 'own'],
      [4, 5, 'own'],
      [9, 10, 'own']
    ])
    expect(seen.ownSources[0]?.passages.map((passage) => passage.id)).toEqual(['b0'])
    expect(seen.ownSources[3]?.passages.map((passage) => passage.id)).toEqual([
      'b9',
      'b10.i0',
      'b10.i1'
    ])
  })

  it('lists passages that cite TextBolt without naming it', () => {
    expect(seen.citedNotNamed.map((line) => line.passageId)).toEqual(['b0', 'b9', 'b10.i1'])
    expect(seen.citedNotNamed[0]?.sentence).toMatch(/^The permanent shutdown of AT&T's/)
  })

  it('counts competitors of the product, named and cited', () => {
    expect(seen.competitors).toEqual([
      { name: 'Twilio', domain: 'twilio.com', tier: 'direct', named: 4, cited: 0 },
      { name: 'MessageBee', domain: 'uniquelibrary.com', tier: 'direct', named: 1, cited: 2 },
      { name: 'Patron Point', domain: 'patronpoint.com', tier: 'partial', named: 1, cited: 0 }
    ])
  })

  it('says how far down the first mention is', () => {
    expect(seen.firstMention).toEqual({
      order: 8,
      of: 14,
      section: '3. Middleware Email-to-SMS Gateway (Drop-in Replacement)'
    })
  })

  it('flags the name SerpApi left out after "TextBolt or"', () => {
    expect(seen.gaps.map((gap) => gap.sentence)).toEqual([
      'How it works: You subscribe to a service like TextBolt or .'
    ])
  })

  it('writes the verdict line', () => {
    expect(seen.verdict).toBe(
      'Named once and cited 4 times — cited for "The permanent shutdown of AT&T\'s email-to-text gateway…"; named under "3. Middleware Email-to-SMS Gateway (Drop-in Replacement)".'
    )
  })
})

describe('observeOverview on small overviews', () => {
  it('names the brand without a citation', () => {
    const seen = observeOverview({
      overview: overview(
        [{ text: 'Try TextBolt or Twilio. TextBolt is simple.', refs: [0] }],
        ['https://twilio.com/docs']
      ),
      lens: LENS,
      references: []
    })
    expect(seen.mentions.map((mention) => mention.cited)).toEqual([false, false])
    expect(seen.namedNotCited).toHaveLength(2)
    expect(seen.mentions[1]?.sentence).toBe('TextBolt is simple.')
    expect(seen.ownSources).toEqual([])
    expect(seen.competitors).toEqual([
      { name: 'Twilio', domain: 'twilio.com', tier: 'direct', named: 1, cited: 1 }
    ])
    expect(seen.verdict).toBe(
      'Named twice but not cited — Google names you without linking your site.'
    )
  })

  it('cites the own site without naming it, by the subdomain rule', () => {
    const urls = ['https://twilio.com/a', 'https://help.textbolt.com/setup']
    const seen = observeOverview({
      overview: overview([{ text: 'Route alerts through a gateway.', refs: [1] }], urls),
      lens: LENS,
      references: []
    })
    expect(seen.ownSources.map((source) => source.position)).toEqual([2])
    expect(seen.citedNotNamed.map((line) => line.passageId)).toEqual(['b0'])
    expect(seen.verdict).toBe(
      'Cited once but never named — first cited for "Route alerts through a gateway." (2nd of 2 sources).'
    )
    const strict = observeOverview({
      overview: overview([{ text: 'Route alerts through a gateway.', refs: [1] }], urls),
      lens: { ...LENS, includeSubdomains: false },
      references: []
    })
    expect(strict.ownSources).toEqual([])
  })

  it('reports an overview that leaves the brand out', () => {
    const seen = observeOverview({
      overview: overview(
        [{ text: 'Twilio and twilio.com docs, or Plivo.', refs: [0] }],
        ['https://www.twilio.com/sms']
      ),
      lens: LENS,
      references: []
    })
    expect(seen.mentions).toEqual([])
    expect(seen.firstMention).toBeNull()
    expect(seen.competitors).toEqual([
      { name: 'Twilio', domain: 'twilio.com', tier: 'direct', named: 2, cited: 1 }
    ])
    expect(seen.verdict).toBe('Not named and not cited — Twilio is named twice and cited once.')
  })

  it('counts competitors per product: another product’s list gives other lines', () => {
    const lens: OverviewLens = {
      ...LENS,
      productName: 'Voice',
      competitors: [{ name: 'Plivo', domain: 'plivo.com', tier: 'partial' }]
    }
    const seen = observeOverview({
      overview: overview([{ text: 'Twilio or Plivo.' }], ['https://plivo.com/x']),
      lens,
      references: []
    })
    expect(seen.competitors).toEqual([
      { name: 'Plivo', domain: 'plivo.com', tier: 'partial', named: 1, cited: 1 }
    ])
  })

  it('keeps a stored competitor the product list no longer has, by its host', () => {
    const seen = observeOverview({
      overview: overview([{ text: 'Use a gateway.', refs: [0] }], ['https://clicksend.com/us']),
      lens: LENS,
      references: [{ url: 'https://clicksend.com/us', classification: 'competitor' }]
    })
    expect(seen.competitors).toEqual([
      { name: 'clicksend.com', domain: 'clicksend.com', tier: null, named: 0, cited: 1 }
    ])
  })

  it('only flags clear empty-slot shapes', () => {
    const seen = observeOverview({
      overview: overview(
        [
          { text: 'Use a service like or Plivo.' },
          { text: 'Pick Twilio or Plivo, then test.' },
          { text: 'Compare TextBolt  and Twilio.' }
        ],
        []
      ),
      lens: LENS,
      references: []
    })
    expect(seen.gaps.map((gap) => gap.passageId)).toEqual(['b0', 'b2'])
  })
})

describe('copy helpers', () => {
  it('writes once, twice, then figures', () => {
    expect([1, 2, 3].map(times)).toEqual(['once', 'twice', '3 times'])
  })

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '103rd'
    ])
  })
})
