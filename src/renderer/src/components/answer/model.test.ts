import { describe, expect, it } from 'vitest'
import type { BrandLens } from '@shared/brand-mentions'
import { NAGIOS_AIO, NAGIOS_CHATGPT, PRICING_AIO } from './answer.fixtures.test-helper'
import { citeKind, foldPlan, siteName, type ScoredSource } from './model'
import { normalizeAnswer } from './normalize'

const LENS: BrandLens = {
  brandNames: ['TextBolt'],
  ownDomain: 'textbolt.com',
  includeSubdomains: true
}

const SOURCES: ScoredSource[] = [
  {
    url: 'https://textbolt.com/integration/nagios-email-to-text-alerts/',
    domain: 'textbolt.com',
    classification: 'target'
  },
  {
    url: 'https://www.twilio.com/en-us/pricing/messaging',
    domain: 'twilio.com',
    classification: 'competitor'
  },
  {
    url: 'https://assets.nagios.com/docs/a.pdf',
    domain: 'assets.nagios.com',
    classification: 'other'
  }
]

describe('normalizeAnswer', () => {
  it('gives a table right under a paragraph line its own block', () => {
    expect(normalizeAnswer('Comparison\nFeature| A| B\n---|---|---\nx| 1| 2')).toBe(
      'Comparison\n\nFeature| A| B\n---|---|---\nx| 1| 2'
    )
  })

  it('leaves a table that already stands alone, and the real overview, as they are', () => {
    expect(normalizeAnswer('Intro\n\nFeature| A\n---|---\nx| 1')).toBe(
      'Intro\n\nFeature| A\n---|---\nx| 1'
    )
    expect(normalizeAnswer(NAGIOS_AIO)).toBe(NAGIOS_AIO.trim())
  })

  it("drops ChatGPT's copy-button caption above a code block, and never edits the code", () => {
    const out = normalizeAnswer(NAGIOS_CHATGPT)
    expect(out).not.toMatch(/\n\ntext\n\n```/)
    expect(out).toContain('```\n                 Nagios\n                   |\n')
    expect(normalizeAnswer('Run:\n\n```\na|b\n---|---\n```')).toBe('Run:\n\n```\na|b\n---|---\n```')
    // A caption with its own language on the fence, or under text, stays.
    expect(normalizeAnswer('bash\n\n```sh\nls\n```')).toBe('bash\n\n```sh\nls\n```')
  })

  it('reads Windows line ends', () => {
    expect(normalizeAnswer('a\r\nb\r\n')).toBe('a\nb')
  })
})

describe('citeKind', () => {
  it('matches the scored source by address, ignoring tracking tags and the trailing slash', () => {
    expect(
      citeKind(
        'https://textbolt.com/integration/nagios-email-to-text-alerts?utm_source=chatgpt.com',
        SOURCES,
        null
      )
    ).toBe('own')
    expect(citeKind('https://twilio.com/en-us/pricing/messaging/', SOURCES, null)).toBe(
      'competitor'
    )
  })

  it('falls back to a scored source on the same site, then the own-site rule', () => {
    expect(citeKind('https://www.twilio.com/en-us/sms', SOURCES, null)).toBe('competitor')
    expect(citeKind('https://textbolt.com/blog/other/', [], LENS)).toBe('own')
    expect(citeKind('https://help.textbolt.com/x', [], LENS)).toBe('own')
    expect(citeKind('https://example.com/', SOURCES, LENS)).toBe('other')
    expect(citeKind('https://textbolt.com/', [], null)).toBe('other')
  })
})

describe('siteName', () => {
  it('shows the short site name', () => {
    expect(siteName('https://assets.nagios.com/downloads/x.pdf')).toBe('nagios.com')
    expect(siteName('https://www.twilio.com/en-us')).toBe('twilio.com')
    expect(siteName('https://news.bbc.co.uk/a')).toBe('bbc.co.uk')
    expect(siteName('https://textbolt.com/')).toBe('textbolt.com')
  })
})

describe('foldPlan', () => {
  it('shows a short answer whole', () => {
    expect(foldPlan('One line.\n\nTwo lines.', [], LENS)).toEqual({
      foldable: false,
      startOpen: false
    })
  })

  it('folds a long answer that names the owner near the top', () => {
    expect(foldPlan(NAGIOS_AIO, SOURCES, LENS)).toEqual({ foldable: true, startOpen: false })
  })

  it('opens a long answer when the owner is only named or cited below the fold', () => {
    const filler = Array.from({ length: 24 }, (_, index) => `Line ${index + 1} about SMS.`).join(
      '\n\n'
    )
    expect(foldPlan(`${filler}\n\nTextBolt also does this.`, [], LENS).startOpen).toBe(true)
    expect(
      foldPlan(
        `${filler}\n\nA guide. [Guide](https://textbolt.com/integration/nagios-email-to-text-alerts/)`,
        SOURCES,
        null
      ).startOpen
    ).toBe(true)
    expect(foldPlan(`${filler}\n\nNothing of ours.`, [], LENS)).toEqual({
      foldable: true,
      startOpen: false
    })
  })

  it('reads the pricing overview, where TextBolt is first named mid-answer', () => {
    expect(foldPlan(PRICING_AIO, [], LENS)).toEqual({ foldable: true, startOpen: true })
  })
})
