import { describe, expect, it } from 'vitest'
import {
  brandMarks,
  brandNamed,
  brandRuns,
  findNames,
  markRuns,
  type BrandLens
} from './brand-mentions'

const LENS: BrandLens = {
  brandNames: ['TextBolt', 'Text Bolt'],
  ownDomain: 'textbolt.com',
  includeSubdomains: true
}

/** The marked strings, in order. */
function marked(text: string, lens: BrandLens = LENS): string[] {
  return brandMarks(text, lens).map((mark) => text.slice(mark.start, mark.end))
}

describe('brand names', () => {
  it('marks a brand name and an alias, ignoring case', () => {
    expect(marked('Try textbolt or Text Bolt today.')).toEqual(['textbolt', 'Text Bolt'])
  })

  it('keeps a possessive inside the mark', () => {
    expect(marked("TextBolt's routing domain and TextBolt’s app")).toEqual([
      "TextBolt's",
      'TextBolt’s'
    ])
  })

  it('marks the brand before punctuation', () => {
    expect(marked('a service like TextBolt, TextBolt. (TextBolt)')).toEqual([
      'TextBolt',
      'TextBolt',
      'TextBolt'
    ])
  })

  it('does not mark a partial word', () => {
    expect(marked('TextBolted and MyTextBolt and TextBolts')).toEqual([])
  })

  it('folds accents and spacing across line breaks', () => {
    expect(
      findNames('Le Rêve\nand Text   Bolt', ['reve', 'Text Bolt']).map((hit) => hit.name)
    ).toEqual(['reve', 'Text Bolt'])
    expect(marked('Text\n  Bolt works')).toEqual(['Text\n  Bolt'])
  })

  it('matches a brand that starts or ends with punctuation on its letters', () => {
    const lens = { ...LENS, brandNames: ['AT&T', 'Booking.com'] }
    expect(marked("AT&T's gateway and booking.com deals", lens)).toEqual(["AT&T's", 'booking.com'])
  })

  it('agrees with the check’s brand-named flag', () => {
    expect(brandNamed('Box is great', ['Box'])).toBe(true)
    expect(brandNamed('check your inbox', ['Box'])).toBe(false)
    expect(brandNamed(null, ['Box'])).toBe(false)
  })
})

describe('own domain', () => {
  it('marks the bare domain, www., a full URL and a subdomain', () => {
    expect(
      marked(
        'See textbolt.com, www.textbolt.com, https://textbolt.com/pricing/ and help.textbolt.com.'
      )
    ).toEqual([
      'textbolt.com',
      'www.textbolt.com',
      'https://textbolt.com/pricing/',
      'help.textbolt.com'
    ])
  })

  it('leaves subdomains out when the project does not count them', () => {
    expect(
      marked('help.textbolt.com and textbolt.com', { ...LENS, includeSubdomains: false })
    ).toEqual(['textbolt.com'])
  })

  it('does not mark another site that ends with the same letters', () => {
    expect(marked('nottextbolt.com and textbolt.co and textbolt.com.au')).toEqual([])
  })

  it('treats the brand inside its own domain as one mark', () => {
    const marks = brandMarks('Visit TextBolt.com now', LENS)
    expect(marks).toEqual([{ start: 6, end: 18, kind: 'domain' }])
  })

  it('marks nothing for an unknown domain and no brand names', () => {
    expect(
      marked('textbolt.com TextBolt', { brandNames: [], ownDomain: '', includeSubdomains: true })
    ).toEqual([])
  })
})

describe('runs', () => {
  it('cuts the text into plain and marked runs that join back to the text', () => {
    const text = 'Use TextBolt or textbolt.com.'
    const runs = brandRuns(text, LENS)
    expect(runs).toEqual([
      { text: 'Use ', marked: false },
      { text: 'TextBolt', marked: true },
      { text: ' or ', marked: false },
      { text: 'textbolt.com', marked: true },
      { text: '.', marked: false }
    ])
    expect(runs.map((run) => run.text).join('')).toBe(text)
  })

  it('gives one plain run with no lens or no marks', () => {
    expect(brandRuns('Twilio', null)).toEqual([{ text: 'Twilio', marked: false }])
    expect(markRuns('', [])).toEqual([{ text: '', marked: false }])
  })
})
