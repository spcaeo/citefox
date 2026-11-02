import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { googleExtrasFromRaw, NO_EXTRAS, readGoogleExtras } from './extras'

const FIXTURES = join(__dirname, '..', 'fixtures', 'serpapi')

function recordedBody(name: string): string {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { body: unknown }
  return JSON.stringify(parsed.body)
}

describe('Google extras from a stored search', () => {
  test('reads the organic top 10 and People also ask from a recorded search', () => {
    const extras = googleExtrasFromRaw(recordedBody('google-page-token-extras.json'))
    expect(extras.organic).toEqual([
      {
        position: 1,
        url: 'https://simpletexting.com/blog/text-employees/',
        domain: 'simpletexting.com'
      },
      {
        position: 2,
        url: 'https://www.twilio.com/en-us/blog/employee-sms-notifications',
        domain: 'twilio.com'
      },
      {
        position: 3,
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        domain: 'textbolt.com'
      },
      { position: 4, url: 'https://textbolt.com/pricing/', domain: 'textbolt.com' }
    ])
    // The repeat in other case and without "?" is left out; Google's order is kept.
    expect(extras.questions).toEqual([
      'Can I send text alerts to employees for free?',
      'Which plan covers scheduled texts?',
      'How do I set up an emergency text alert system?',
      'What is the best mass texting service for small business?',
      'Is business texting legal?'
    ])
  })

  test('a search with an overview but no organic list says so (null), not "none"', () => {
    const extras = googleExtrasFromRaw(recordedBody('google-ai-overview.json'))
    expect(extras).toEqual({ organic: null, questions: [] })
  })

  test('an empty organic list is read as Google results without the site', () => {
    expect(readGoogleExtras({ organic_results: [] })).toEqual({ organic: [], questions: [] })
  })

  test('null, empty, cut-off and non-object bodies give no extras', () => {
    expect(googleExtrasFromRaw(null)).toBe(NO_EXTRAS)
    expect(googleExtrasFromRaw('')).toBe(NO_EXTRAS)
    const cut = recordedBody('google-page-token-extras.json').slice(0, 300)
    expect(googleExtrasFromRaw(cut)).toBe(NO_EXTRAS)
    expect(googleExtrasFromRaw('[1,2]')).toBe(NO_EXTRAS)
    expect(googleExtrasFromRaw('"text"')).toBe(NO_EXTRAS)
  })

  test('old or odd shapes are skipped item by item', () => {
    const extras = readGoogleExtras({
      organic_results: [
        null,
        { title: 'no link' },
        { link: 'javascript:alert(1)' },
        { link: 'not a url' },
        { link: 'https://www.example.com/a' },
        { position: 'x', link: 'https://two.example/b' },
        { position: 11, link: 'https://late.example/' },
        { position: 3, link: 'https://three.example/c' }
      ],
      related_questions: [
        { question: '  How   does it work?  ' },
        { question: 42 },
        'a string',
        { question: '' },
        { question: '???' },
        { question: 'x'.repeat(301) }
      ]
    })
    // A missing position falls back to the place in the list; past the top 10 is dropped.
    expect(extras.organic).toEqual([
      { position: 3, url: 'https://three.example/c', domain: 'three.example' },
      { position: 5, url: 'https://www.example.com/a', domain: 'example.com' },
      { position: 6, url: 'https://two.example/b', domain: 'two.example' }
    ])
    expect(extras.questions).toEqual(['How does it work?'])
  })

  test('keeps at most twelve questions', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ question: `Question ${index}?` }))
    expect(readGoogleExtras({ related_questions: many }).questions).toHaveLength(12)
  })
})
