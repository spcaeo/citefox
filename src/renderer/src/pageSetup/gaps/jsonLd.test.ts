import { describe, expect, it } from 'vitest'
import { brandsNamed, draftWords, faqPageJsonLd, faqPageJsonLdText } from './jsonLd'
import { readSectionUrl } from './status'

describe('FAQPage JSON-LD', () => {
  it('builds schema.org FAQPage data, skipping empty and repeated questions', () => {
    const data = faqPageJsonLd([
      { question: ' Does it work with Gmail? ', answer: 'Yes, and Outlook.', wordCount: 3 },
      null,
      { question: 'does it work with gmail?', answer: 'Repeat.', wordCount: 1 },
      { question: 'Empty answer', answer: '  ', wordCount: 0 }
    ])
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Does it work with Gmail?',
          acceptedAnswer: { '@type': 'Answer', text: 'Yes, and Outlook.' }
        }
      ]
    })
    expect(faqPageJsonLdText([null])).toBeNull()
    expect(
      JSON.parse(faqPageJsonLdText([{ question: 'Q?', answer: 'A.', wordCount: 1 }]) ?? '')
    ).toMatchObject({ '@type': 'FAQPage' })
  })

  it('counts words, finds brand names as whole words, and reads a section URL', () => {
    expect(draftWords('  one two\nthree  ')).toBe(3)
    expect(draftWords('')).toBe(0)
    expect(brandsNamed('TextBolt texts your crew.', ['TextBolt', 'Bolt'])).toEqual(['TextBolt'])
    expect(brandsNamed('textbolt.com works', ['TextBolt'])).toEqual(['TextBolt'])
    expect(readSectionUrl('')).toEqual({ url: null, error: null })
    expect(readSectionUrl('https://textbolt.com/a#faq').url).toBe('https://textbolt.com/a#faq')
    expect(readSectionUrl('ftp://x').error).toMatch(/https/)
    expect(readSectionUrl('not a url').error).toMatch(/full web address/)
  })
})
