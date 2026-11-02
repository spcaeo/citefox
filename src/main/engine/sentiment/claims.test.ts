import { describe, expect, test } from 'vitest'
import type { SentimentReference } from '@shared/domain'
import {
  aioHash,
  applyFactChecks,
  brandKeys,
  brandToken,
  claimsSchemaError,
  factCheckSchemaError,
  matchBrand,
  ownClaims,
  processReply,
  sourceKindFor,
  type ClaimsReply
} from './claims'
import { factsText, languageName, referencesText } from './context'

const REFS: SentimentReference[] = [
  {
    position: 1,
    url: 'https://www.g2.com/products/textbolt/reviews',
    domain: 'g2.com',
    title: 'TextBolt reviews',
    classification: 'other',
    sourceType: 'review'
  },
  {
    position: 2,
    url: 'https://textbolt.com/pricing/',
    domain: 'textbolt.com',
    title: 'Pricing',
    classification: 'own',
    sourceType: 'web'
  }
]

const KEYS = brandKeys(['TextBolt', 'Text Bolt'], ['simpletexting.com', 'Twilio'])
const AIO = 'TextBolt has no free plan. SimpleTexting includes replies.'

function reply(claims: Partial<ClaimsReply['claims'][number]>[]): ClaimsReply {
  return {
    brandsNamed: ['TextBolt', 'SimpleTexting', 'Nobody'],
    reason: '  Named   first. ',
    claims: claims.map((claim) => ({
      brand: 'TextBolt',
      theme: 'pricing',
      attribute: 'no free plan',
      tone: 'negative',
      sentence: 'TextBolt has no free plan.',
      url: null,
      ...claim
    }))
  }
}

describe('brand matching', () => {
  test('an alias maps to the first brand name and a domain matches its name', () => {
    expect(matchBrand(KEYS, 'text bolt')).toEqual({ brand: 'TextBolt', isOwn: true })
    expect(matchBrand(KEYS, 'SimpleTexting')).toEqual({ brand: 'simpletexting.com', isOwn: false })
    expect(matchBrand(KEYS, 'https://www.twilio.com')).toEqual({ brand: 'Twilio', isOwn: false })
    expect(matchBrand(KEYS, 'Klaviyo')).toBeNull()
    expect(brandToken('www.SimpleTexting.com/pricing')).toBe('simpletexting')
  })

  test("a product's competitor answers to its name and domain, stored under the flat key", () => {
    const keys = brandKeys(
      ['TextBolt'],
      ['salesmessage.com'],
      new Map([['salesmessage.com', ['Salesmsg']]])
    )
    expect(matchBrand(keys, 'Salesmsg')).toEqual({ brand: 'salesmessage.com', isOwn: false })
    expect(matchBrand(keys, 'Salesmessage')).toEqual({ brand: 'salesmessage.com', isOwn: false })
    expect(matchBrand(keys, 'Podium')).toBeNull()
  })
})

describe('processReply', () => {
  const context = { keys: KEYS, aioText: AIO, references: REFS }

  test('drops sentences that are not in the overview and brands that are not listed', () => {
    const processed = processReply(
      reply([
        {},
        { sentence: 'TextBolt is the best tool ever.' },
        { brand: 'Klaviyo', sentence: 'SimpleTexting includes replies.' },
        { brand: 'SimpleTexting', tone: 'positive', sentence: 'simpletexting  includes REPLIES.' }
      ]),
      context
    )
    expect(processed.dropped).toBe(2)
    expect(processed.claims.map((claim) => claim.brand)).toEqual(['TextBolt', 'simpletexting.com'])
    expect(processed.claims[0]?.theme).toBe('Pricing')
    expect(processed.brandsNamed).toEqual(['TextBolt', 'simpletexting.com'])
    expect(processed.reason).toBe('Named first.')
  })

  test('keeps only cited URLs, in the overview spelling', () => {
    const processed = processReply(
      reply([
        { url: 'https://g2.com/products/textbolt/reviews/' },
        { attribute: 'paid from day one', url: 'https://example.com/not-cited' }
      ]),
      context
    )
    expect(processed.claims.map((claim) => claim.url)).toEqual([
      'https://www.g2.com/products/textbolt/reviews',
      null
    ])
  })

  test('a claim repeated word for word is kept once', () => {
    const processed = processReply(reply([{}, { attribute: ' No free  plan ' }]), context)
    expect(processed.claims).toHaveLength(1)
    expect(processed.dropped).toBe(1)
  })
})

describe('fact check (FR-16.6)', () => {
  const claims = processReply(
    reply([
      { attribute: 'no free plan' },
      { brand: 'SimpleTexting', tone: 'positive', sentence: 'SimpleTexting includes replies.' },
      { attribute: 'paid only', tone: 'neutral' }
    ]),
    { keys: KEYS, aioText: AIO, references: REFS }
  ).claims
  const problem = {
    why: 'The page says $29.',
    correction: 'Plans start at $29.',
    sourceToFix: 'https://textbolt.com/pricing'
  }

  test('only the own-brand claims are numbered, and checks join back to them', () => {
    expect(ownClaims(claims).map((claim) => claim.attribute)).toEqual(['no free plan', 'paid only'])
    const joined = applyFactChecks(
      claims,
      {
        checks: [
          { claimIndex: 1, problem: { basis: 'page', ...problem } },
          { claimIndex: 0, problem: null },
          { claimIndex: 1, problem: { basis: 'page', ...problem, why: 'second check' } }
        ]
      },
      { facts: [], references: REFS, ownUrls: ['https://textbolt.com/blog/a/'] }
    )
    expect(joined.map((claim) => claim.factProblem?.why ?? null)).toEqual([
      null,
      null,
      'The page says $29.'
    ])
    // The cited URL, in the overview's spelling.
    expect(joined[2]?.factProblem?.sourceToFix).toBe('https://textbolt.com/pricing/')
  })

  test('a fact basis needs brand facts, and a URL to fix is cited or an own page shown', () => {
    const facts = [
      { id: 'f', text: 'Plans start at $29.', source: null, addedAt: '2026-10-19T00:00:00.000Z' }
    ]
    const check = {
      checks: [{ claimIndex: 0, problem: { basis: 'fact' as const, ...problem } }]
    }
    const none = applyFactChecks(claims, check, { facts: [], references: REFS, ownUrls: [] })
    expect(none[0]?.factProblem).toBeNull()
    const kept = applyFactChecks(claims, check, { facts, references: REFS, ownUrls: [] })
    expect(kept[0]?.factProblem?.basis).toBe('fact')
    const ownPage = applyFactChecks(
      claims,
      {
        checks: [
          {
            claimIndex: 0,
            problem: { basis: 'page', ...problem, sourceToFix: 'https://textbolt.com/plans' }
          }
        ]
      },
      { facts, references: REFS, ownUrls: ['https://textbolt.com/plans/'] }
    )
    expect(ownPage[0]?.factProblem?.sourceToFix).toBe('https://textbolt.com/plans/')
    const elsewhere = applyFactChecks(
      claims,
      {
        checks: [
          {
            claimIndex: 0,
            problem: { basis: 'page', ...problem, sourceToFix: 'https://example.com/x' }
          }
        ]
      },
      { facts, references: REFS, ownUrls: [] }
    )
    expect(elsewhere[0]?.factProblem?.sourceToFix).toBeNull()
  })

  test('a claimIndex outside the claims sent fails validation', () => {
    expect(factCheckSchemaError({ checks: [{ claimIndex: 1, problem: null }] }, 2)).toBeNull()
    expect(factCheckSchemaError({ checks: [{ claimIndex: 2, problem: null }] }, 2)).toContain(
      'claimIndex 2'
    )
    expect(factCheckSchemaError({ checks: [{ claimIndex: 0 }] }, 2)).not.toBeNull()
  })
})

describe('context text', () => {
  test('languages are named in English and facts and sources are listed', () => {
    expect(languageName('es')).toBe('Spanish (es)')
    expect(languageName('en')).toBe('English (en)')
    expect(factsText([])).toBe('No brand facts yet.')
    expect(
      factsText([
        {
          id: 'f',
          text: 'Plans start at $29.',
          source: 'https://textbolt.com/pricing',
          addedAt: ''
        }
      ])
    ).toBe('- Plans start at $29. (source: https://textbolt.com/pricing)')
    expect(referencesText(REFS)).toBe(
      '1. TextBolt reviews — https://www.g2.com/products/textbolt/reviews\n2. Pricing — https://textbolt.com/pricing/'
    )
  })

  test('source kinds come from the stored classification', () => {
    expect(sourceKindFor('https://g2.com/products/textbolt/reviews', REFS)).toBe('review')
    expect(sourceKindFor('https://textbolt.com/pricing/', REFS)).toBe('own')
    expect(sourceKindFor(null, REFS)).toBeNull()
  })

  test('the overview hash covers its text and its sources', () => {
    expect(aioHash(AIO, REFS)).toHaveLength(64)
    expect(aioHash(AIO, REFS)).not.toBe(aioHash(AIO, REFS.slice(0, 1)))
    expect(claimsSchemaError({ brandsNamed: [], reason: '', claims: [] })).toBeNull()
    expect(claimsSchemaError({ claims: [] })).not.toBeNull()
  })
})
