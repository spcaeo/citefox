import { describe, expect, test } from 'vitest'
import { guardCompanyIdeas, hostsIn, normalizePath } from './competitor-guard'
import { TEXTBOLT_BAD_REPLY, TEXTBOLT_GUARD_PAGES } from './competitor-guard.test-helper'

const OPTIONS = { ownDomain: 'textbolt.com', brandNames: ['TextBolt'] }

describe('guardCompanyIdeas (feedback 3: textbolt.com)', () => {
  const result = guardCompanyIdeas(TEXTBOLT_BAD_REPLY, TEXTBOLT_GUARD_PAGES, OPTIONS)

  test('keeps only the live rivals the compare page names as competitors', () => {
    expect(result.competitors.map((item) => item.name)).toEqual(['Text-Em-All', 'SimpleTexting'])
  })

  test('moves the carriers whose gateways shut down to what buyers switch from', () => {
    expect(result.switchingFrom.map((item) => item.name)).toEqual(['AT&T', 'Verizon', 'T-Mobile'])
  })

  test('moves the alarm software that sends through the product to integrations', () => {
    expect(result.integrations.map((item) => item.name)).toEqual(['WIN-911'])
  })

  test('never keeps a domain the pages do not link to or name', () => {
    const domains = Object.fromEntries(
      [...result.competitors, ...result.switchingFrom, ...result.integrations].map((item) => [
        item.name,
        { domain: item.domain, checkDomain: item.checkDomain }
      ])
    )
    // text-em-all.com is linked from /compare: Claude's textemall.com takes that spelling.
    expect(domains['Text-Em-All']).toEqual({ domain: 'text-em-all.com', checkDomain: false })
    expect(domains.SimpleTexting).toEqual({ domain: null, checkDomain: true })
    expect(domains['AT&T']).toEqual({ domain: null, checkDomain: true })
    expect(domains['WIN-911']).toEqual({ domain: null, checkDomain: true })
  })

  test('leaves out names the pages never mention and the business’s own brand', () => {
    expect(result.dropped).toEqual([
      { name: 'Twilio', why: 'not named on the pages read' },
      { name: 'TextBolt', why: 'the business’s own brand' }
    ])
  })

  test('keeps each item’s evidence, with the path normalised', () => {
    const simple = result.competitors.find((item) => item.name === 'SimpleTexting')
    expect(simple?.evidence).toEqual({
      path: '/compare',
      quote: 'SimpleTexting starts with a monthly plan.'
    })
  })
})

describe('guardCompanyIdeas rules', () => {
  const pages = TEXTBOLT_GUARD_PAGES

  test('a correct reply passes unchanged', () => {
    const good = guardCompanyIdeas(
      {
        competitors: [
          {
            name: 'Text-Em-All',
            domain: 'text-em-all.com',
            reason: 'Same job.',
            evidence: { path: '/compare', quote: 'TextBolt vs Text-Em-All' }
          }
        ],
        switchingFrom: [
          {
            name: 'AT&T email-to-text gateway',
            domain: null,
            reason: 'It shut down.',
            evidence: { path: '/att-email-to-text-alternative', quote: 'AT&T shut down' }
          }
        ],
        integrations: [
          {
            name: 'Gmail',
            domain: null,
            reason: 'Users send from it.',
            evidence: { path: '/', quote: 'Send texts from Gmail or Outlook.' }
          }
        ]
      },
      pages,
      OPTIONS
    )
    expect(good.competitors.map((item) => [item.name, item.domain])).toEqual([
      ['Text-Em-All', 'text-em-all.com']
    ])
    expect(good.switchingFrom.map((item) => item.name)).toEqual(['AT&T email-to-text gateway'])
    expect(good.integrations.map((item) => item.name)).toEqual(['Gmail'])
    expect(good.dropped).toEqual([])
  })

  test('a competitor with the same name as an integration is left out', () => {
    const result = guardCompanyIdeas(
      {
        competitors: [
          {
            name: 'WIN-911',
            domain: null,
            reason: 'x',
            evidence: { path: '/compare', quote: 'TextBolt vs WIN-911' }
          }
        ],
        switchingFrom: [],
        integrations: [
          {
            name: 'WIN 911',
            domain: null,
            reason: 'Sends alarms.',
            evidence: { path: '/win-911', quote: 'WIN-911 integration.' }
          }
        ]
      },
      pages,
      OPTIONS
    )
    expect(result.competitors).toEqual([])
    expect(result.integrations.map((item) => item.name)).toEqual(['WIN 911'])
    expect(result.dropped).toEqual([{ name: 'WIN-911', why: 'listed twice' }])
  })

  test('a bracketed note in place of a domain becomes "domain unknown"', () => {
    const result = guardCompanyIdeas(
      {
        competitors: [
          {
            name: 'SimpleTexting',
            domain: '[Domain not shown in the saved data; check it]',
            reason: 'x',
            evidence: { path: '/compare', quote: 'SimpleTexting' }
          }
        ],
        switchingFrom: [],
        integrations: []
      },
      pages,
      OPTIONS
    )
    expect(result.competitors[0]).toMatchObject({ domain: null, checkDomain: true })
  })

  test('review sites and carriers are not competitors', () => {
    const withReview = [
      ...pages,
      { path: '/reviews', text: 'Rated 4.8 on g2.com and verizon.com lists us.' }
    ]
    const result = guardCompanyIdeas(
      {
        competitors: [
          {
            name: 'G2',
            domain: 'g2.com',
            reason: 'x',
            evidence: { path: '/reviews', quote: 'Rated 4.8 on g2.com' }
          },
          {
            name: 'Verizon',
            domain: 'verizon.com',
            reason: 'x',
            evidence: { path: '/reviews', quote: 'verizon.com lists us' }
          }
        ],
        switchingFrom: [],
        integrations: []
      },
      withReview,
      OPTIONS
    )
    expect(result.competitors).toEqual([])
    expect(result.dropped.map((item) => item.name)).toEqual(['G2', 'Verizon'])
  })

  test('an "alternative to X" page about a live product stays a competitor', () => {
    const live = [
      {
        path: '/simpletexting-alternative',
        text: 'Looking for a SimpleTexting alternative? TextBolt costs less for internal alerts.'
      }
    ]
    const result = guardCompanyIdeas(
      {
        competitors: [
          {
            name: 'SimpleTexting',
            domain: null,
            reason: 'Same buyers.',
            evidence: {
              path: '/simpletexting-alternative',
              quote: 'Looking for a SimpleTexting alternative?'
            }
          }
        ],
        switchingFrom: [],
        integrations: []
      },
      live,
      OPTIONS
    )
    expect(result.competitors.map((item) => item.name)).toEqual(['SimpleTexting'])
  })

  test('evidence must come from a page read', () => {
    const result = guardCompanyIdeas(
      {
        competitors: [
          {
            name: 'SimpleTexting',
            domain: null,
            reason: 'x',
            evidence: { path: '/blog/not-read', quote: 'SimpleTexting' }
          },
          {
            name: 'Text-Em-All',
            domain: null,
            reason: 'x',
            evidence: { path: 'Compare page', quote: 'TextBolt vs Text-Em-All' }
          }
        ],
        switchingFrom: [],
        integrations: []
      },
      pages,
      OPTIONS
    )
    expect(result.competitors.map((item) => [item.name, item.evidence?.path])).toEqual([
      ['Text-Em-All', '/compare']
    ])
    expect(result.dropped).toEqual([{ name: 'SimpleTexting', why: 'no evidence from a page read' }])
  })

  test('a domain Google already cites is kept even when the pages do not show it', () => {
    const result = guardCompanyIdeas(
      {
        competitors: [
          {
            name: 'Textline',
            domain: 'textline.com',
            reason: 'Shared inbox texting.',
            evidence: null
          }
        ],
        switchingFrom: [],
        integrations: []
      },
      pages,
      { ...OPTIONS, seenDomains: ['textline.com'] }
    )
    expect(result.competitors[0]).toMatchObject({ domain: 'textline.com', checkDomain: false })
  })
})

describe('helpers', () => {
  test('normalizePath', () => {
    expect(normalizePath('https://textbolt.com/Compare/?x=1')).toBe('/compare')
    expect(normalizePath('compare/')).toBe('/compare')
    expect(normalizePath('/')).toBe('/')
  })

  test('hostsIn reads hosts from text and links', () => {
    expect(
      hostsIn({
        path: '/',
        text: 'See https://www.Text-Em-All.com or simpletexting.com.',
        links: ['https://g2.com/x']
      }).sort()
    ).toEqual(['g2.com', 'simpletexting.com', 'text-em-all.com'])
  })
})
