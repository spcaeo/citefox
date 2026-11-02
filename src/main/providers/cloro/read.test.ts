import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { NO_EXTRAS } from '../serpapi/extras'
import { CLORO_EMPTY_ANSWER_CHARS, readCloroAnswer, readCloroGoogle } from './read'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/cloro')

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

describe('readCloroGoogle', () => {
  test('reads the AI Overview text, sources and markdown from the recorded body', () => {
    const read = readCloroGoogle(fixture('google-overview.json'))
    expect(read.overview).not.toBeNull()
    const overview = read.overview
    expect(overview?.text).toMatch(/^Yes, AT&T permanently shut down its email-to-text/)
    // Newlines and runs of spaces are collapsed, like the SerpApi reader.
    expect(overview?.text).not.toMatch(/\s{2,}|\n/)
    expect(overview?.pageToken).toBeNull()
    expect(overview?.error).toBeNull()
    expect(overview?.references).toEqual([
      {
        url: 'https://www.att.com/support/article/wireless/KM1061254/',
        title: 'Say Goodbye to Email-to-Text and Text-to-Email - AT&T'
      },
      {
        url: 'https://www.txtimpact.com/blog/att-email-to-text-alternative',
        title: 'AT&T Email to Text Alternative -TXTImpact | AT&T Replacement'
      },
      { url: 'https://simplifiedalerts.com/att-email-to-text/', title: 'AT&T Email-to' },
      {
        url: 'https://textbolt.com/blog/att-email-to-text-shutdown/',
        title: 'When Did AT&T Shut Down Email-to-Text?'
      },
      {
        url: 'https://textbolt.com/migration/att/',
        title: 'AT&T Email to Text Shutdown — Switch to TextBolt'
      }
    ])
    expect(read.markdown).toMatch(/^Yes, AT&T permanently shut down/)
    expect(read.markdown).toContain('**June 17, 2025**')
  })

  test('maps organic results and "People also ask" into the extras', () => {
    const { extras } = readCloroGoogle(fixture('google-overview.json'))
    expect(extras.organic).toHaveLength(8)
    expect(extras.organic?.[0]).toEqual({
      position: 1,
      url: 'https://www.att.com/support/article/wireless/KM1061254/',
      domain: 'att.com'
    })
    expect(extras.organic?.[1]).toMatchObject({ position: 2, domain: 'notifyre.com' })
    expect(extras.organic?.map((item) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(extras.questions).toEqual([
      'Does AT&T no longer support email-to-text?',
      'Which carriers still support email-to-text?',
      'What are some free alternatives to AT&T email-to-text services?',
      'Is AT&T having trouble sending text messages?'
    ])
  })

  test('a search with no AI Overview gives overview null but keeps the extras', () => {
    const read = readCloroGoogle(fixture('google-no-overview.json'))
    expect(read.overview).toBeNull()
    expect(read.markdown).toBeNull()
    expect(read.extras.organic).toHaveLength(9)
    expect(read.extras.questions).toHaveLength(4)
  })

  test('an overview with no text and no sources is no overview', () => {
    const body = JSON.stringify({
      success: true,
      result: { aioverview: { text: '  ', sources: [], markdown: '' } }
    })
    expect(readCloroGoogle(body)).toMatchObject({ overview: null, markdown: null })
  })

  test('unreadable or result-less bodies give the empty read', () => {
    expect(readCloroGoogle('not json')).toEqual({
      overview: null,
      markdown: null,
      extras: NO_EXTRAS
    })
    expect(readCloroGoogle(JSON.stringify({ success: true }))).toEqual({
      overview: null,
      markdown: null,
      extras: NO_EXTRAS
    })
  })
})

describe('readCloroAnswer', () => {
  test('reads the recorded ChatGPT answer: text, markdown and sources', () => {
    const read = readCloroAnswer(fixture('chatgpt.json'))
    expect(read.empty).toBe(false)
    expect(read.text).toMatch(/^Yes\. AT&T discontinued its email-to-text service/)
    expect(read.markdown).toMatch(/^Yes\. AT&T discontinued its email-to-text service/)
    expect(read.sources).toHaveLength(5)
    expect(read.sources.map((source) => source.position)).toEqual([1, 2, 3, 4, 5])
    expect(read.sources[0]).toEqual({
      position: 1,
      url: 'https://www.att.com/support/article/wireless/KM1061254/?source=ESSZ0SSPR00T1EsEM&wtExtndSource=20230316030329_ATT_Mobility_REDDIT_9178492937',
      title: 'Say Goodbye to Email-to-Text and Text-to-Email'
    })
    expect(read.sources[1]?.url).toBe(
      'https://oit.princeton.edu/news/att-discontinues-email-text-and-text-email-service'
    )
    // Citation pills repeat the sources, so none are added twice.
    expect(new Set(read.sources.map((source) => source.url)).size).toBe(5)
  })

  test('a short answer with no sources is empty, text kept', () => {
    const body = JSON.stringify({
      success: true,
      result: { text: "I can't help with that request.", sources: [], markdown: null }
    })
    const read = readCloroAnswer(body)
    expect(read).toEqual({
      text: "I can't help with that request.",
      markdown: null,
      sources: [],
      empty: true
    })
  })

  test('the empty rule is no sources and under 160 characters', () => {
    const atLimit = 'a'.repeat(CLORO_EMPTY_ANSWER_CHARS)
    const under = 'a'.repeat(CLORO_EMPTY_ANSWER_CHARS - 1)
    const answer = (text: string, sources: unknown[] = []): string =>
      JSON.stringify({ success: true, result: { text, sources } })
    expect(CLORO_EMPTY_ANSWER_CHARS).toBe(160)
    expect(readCloroAnswer(answer(under)).empty).toBe(true)
    expect(readCloroAnswer(answer(atLimit)).empty).toBe(false)
    expect(
      readCloroAnswer(answer('Short.', [{ position: 1, url: 'https://a.example/', label: 'A' }]))
        .empty
    ).toBe(false)
  })

  test('markdown stands in for missing text when judging emptiness', () => {
    const body = JSON.stringify({
      success: true,
      result: { text: '', markdown: 'm'.repeat(200), sources: [] }
    })
    const read = readCloroAnswer(body)
    expect(read.text).toBeNull()
    expect(read.empty).toBe(false)
  })

  test('an unreadable body is an empty answer', () => {
    expect(readCloroAnswer('{')).toEqual({ text: null, markdown: null, sources: [], empty: true })
    expect(readCloroAnswer(fixture('perplexity-unavailable.json')).empty).toBe(true)
  })
})
