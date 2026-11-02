import { describe, expect, test } from 'vitest'
import { THREAD_EXCERPT_MAX, THREAD_QUOTE_MAX } from '@shared/domain'
import { brandSentence, splitSentences, threadExcerpt, trimText } from './excerpt'

describe('threadExcerpt', () => {
  test('joins the title and the top post with a blank line', () => {
    expect(threadExcerpt('vtext.com shutting down', 'Our alarm panels send to @vtext.com.')).toBe(
      'vtext.com shutting down\n\nOur alarm panels send to @vtext.com.'
    )
  })

  test('keeps the title alone for a link post, and null when there is nothing', () => {
    expect(threadExcerpt('Only a title', null)).toBe('Only a title')
    expect(threadExcerpt(null, '   ')).toBeNull()
    expect(threadExcerpt(null, null)).toBeNull()
  })

  test('collapses runs of spaces and blank lines in the post', () => {
    expect(threadExcerpt('T', 'one   two\n\n\n\nthree\r\n')).toBe('T\n\none two\n\nthree')
  })

  test('trims a long post to the limit on a word boundary with an ellipsis', () => {
    const post = 'word '.repeat(400)
    const excerpt = threadExcerpt('Title', post) ?? ''
    expect(excerpt.length).toBeLessThanOrEqual(THREAD_EXCERPT_MAX)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).not.toMatch(/wor…$/)
  })
})

describe('trimText', () => {
  test('leaves short text alone and cuts long text at a space', () => {
    expect(trimText('short', 10)).toBe('short')
    expect(trimText('alpha beta gamma delta', 12)).toBe('alpha beta…')
    expect(trimText('abcdefghijklmnop', 6)).toBe('abcde…')
  })
})

describe('splitSentences', () => {
  test('splits on sentence ends and line breaks', () => {
    expect(splitSentences('One. Two? Three!\nFour')).toEqual(['One.', 'Two?', 'Three!', 'Four'])
  })

  test('keeps domains and decimals inside a sentence', () => {
    expect(splitSentences('We use vtext.com today. It costs 2.5 cents.')).toEqual([
      'We use vtext.com today.',
      'It costs 2.5 cents.'
    ])
  })
})

describe('brandSentence', () => {
  const brands = ['TextBolt']

  test('finds the first sentence naming the brand, title then post then comments', () => {
    expect(
      brandSentence(
        ['vtext.com shutting down', 'Our panels send email. What now?'],
        ['We moved to a gateway.', 'TextBolt worked for us, took 20 minutes. Cheap too.'],
        brands
      )
    ).toBe('TextBolt worked for us, took 20 minutes.')
    expect(brandSentence(['Is TextBolt any good?'], ['TextBolt rocks.'], brands)).toBe(
      'Is TextBolt any good?'
    )
  })

  test('matches whole words with case and accents folded, like the check classifier', () => {
    expect(brandSentence([], ['we tried textbolt last week'], brands)).toBe(
      'we tried textbolt last week'
    )
    expect(brandSentence([], ['Our textboltish idea failed.'], brands)).toBeNull()
    expect(brandSentence([], ['On aime Rêve beaucoup.'], ['Reve'])).toBe('On aime Rêve beaucoup.')
  })

  test('is null without brand names or a match', () => {
    expect(brandSentence(['TextBolt'], [], [])).toBeNull()
    expect(brandSentence(['Nothing here.'], ['Or here.'], brands)).toBeNull()
  })

  test('trims a very long sentence around the brand', () => {
    const long = `${'lead '.repeat(80)}TextBolt ${'tail '.repeat(80)}`
    const quote = brandSentence([], [long], brands) ?? ''
    expect(quote.length).toBeLessThanOrEqual(THREAD_QUOTE_MAX)
    expect(quote).toContain('TextBolt')
    expect(quote.startsWith('…')).toBe(true)
    expect(quote.endsWith('…')).toBe(true)
  })
})
