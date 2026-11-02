import { describe, expect, test } from 'vitest'
import {
  backedBy,
  CHECK_MIN_CHARS,
  cutAtSentence,
  groundSummary,
  ordinaryName,
  sitePathOrNull,
  siteCheckOf,
  unbackedNumbers,
  withoutGuessedSizes
} from './site-grounding'
import { thinRead } from './fill-from-website'

/** Page text long enough for the text checks, saying what the site really says. */
const TEXT = [
  'Acme sells scheduling software for teams. More than 40,000 companies use Acme.',
  'Corporate cards in 30+ countries. Plans start at $29 a month.',
  'Built for recruiting teams and healthcare clinics. Switch from Calendly in minutes.',
  'Acme Pay and Booker are included. Keep files in storage and view reminders in one place.'
]
  .join('\n')
  .padEnd(CHECK_MIN_CHARS + 10, ' filler words about scheduling.')

const check = siteCheckOf({
  pages: [{ path: '/', title: 'Acme · Scheduling' }],
  menu: [{ text: 'Healthcare', path: '/scheduling/healthcare' }],
  text: TEXT
})

describe('site grounding', () => {
  test('a label the site never uses comes out; a noun becomes "product"', () => {
    expect(groundSummary('Acme sells a cloud scheduling platform to teams.', check)).toBe(
      'Acme sells a scheduling product to teams.'
    )
    expect(groundSummary('Acme sells an AI-powered booking tool.', check)).toBe(
      'Acme sells a booking tool.'
    )
  })

  test('a sentence with a number the site does not back is dropped, never the only one', () => {
    expect(
      groundSummary('Acme sells scheduling software. It issues cards in 30+ currencies.', check)
    ).toBe('Acme sells scheduling software.')
    expect(groundSummary('More than 40,000 companies use it.', check)).toBe(
      'More than 40,000 companies use it.'
    )
    expect(groundSummary('Used by 90,000 teams.', check)).toBe('Used by 90,000 teams.')
  })

  test('numbers: the same number next to the same word, years and versions are names', () => {
    if (check === null) throw new Error('no check')
    expect(unbackedNumbers(check, 'cards in 30+ countries')).toEqual([])
    expect(unbackedNumbers(check, 'cards in 30+ currencies')).toEqual(['30 currencies'])
    expect(unbackedNumbers(check, 'a $1,400 monthly bill')).toEqual(['1400'])
    expect(unbackedNumbers(check, 'moving off Windows 10 in 2025')).toEqual([])
    // The noun may come one word later: "30+ partner countries" is backed by "30+ countries".
    expect(unbackedNumbers(check, 'cards in 30+ partner countries')).toEqual([])
  })

  test('guessed size bands and money come out of a buyer line', () => {
    expect(withoutGuessedSizes('CFOs at SaaS startups (50-300 employees)', check)).toBe(
      'CFOs at SaaS startups'
    )
    expect(withoutGuessedSizes('IT leads at enterprises with 1,000+ employees', check)).toBe(
      'IT leads at enterprises'
    )
    expect(withoutGuessedSizes('Founders of 5-person B2B startups', check)).toBe(
      'Founders of B2B startups'
    )
    expect(withoutGuessedSizes('Skincare brands doing $500K–$5M a year', check)).toBe(
      'Skincare brands'
    )
  })

  test('evidence: words copied from the pages or a real page path', () => {
    if (check === null) throw new Error('no check')
    expect(backedBy(check, '"recruiting teams"')).toBe(true)
    expect(backedBy(check, '/scheduling/healthcare')).toBe(true)
    expect(backedBy(check, '/')).toBe(false)
    expect(backedBy(check, 'independent therapists')).toBe(false)
  })

  test('paths: only real ones stay; no site keeps the path as given', () => {
    expect(sitePathOrNull(check, '/scheduling/healthcare/')).toBe('/scheduling/healthcare/')
    expect(sitePathOrNull(check, '/calendly-alternative/')).toBeNull()
    expect(sitePathOrNull(null, '/calendly-alternative/')).toBe('/calendly-alternative/')
  })

  test('a short read turns the text checks off', () => {
    const short = siteCheckOf({ pages: [{ path: '/', title: 'Home' }], menu: [], text: 'Hi.' })
    expect(groundSummary('Acme sells a cloud platform.', short)).toBe(
      'Acme sells a cloud platform.'
    )
  })

  test('a long text is cut at a sentence end', () => {
    const text = 'One sentence here. Two sentences here. Three sentences that run on and on.'
    expect(cutAtSentence(text, 45)).toBe('One sentence here. Two sentences here.')
  })

  test('a read of fewer than 3 pages stops with plain words', () => {
    expect(thinRead('zoho.com', 1, 2053)).toBe(
      'Only 1 page (about 2 KB of text) of zoho.com could be read: too little to say what it sells without guessing. The site may block automatic readers with a robot check, or build its pages with scripts. You can try again in a few minutes, use your own ChatGPT (it can open the site for you), or type what it sells yourself.'
    )
    expect(thinRead('cal.com', 3, 11034)).toBeNull()
  })

  test('a made-up team size in a situation prompt comes out, with the right article', () => {
    expect(
      withoutGuessedSizes('We are a 40-person engineering team. What should we use?', check)
    ).toBe('We are an engineering team. What should we use?')
    expect(withoutGuessedSizes('We are a team of 800 and need a tracker.', check)).toBe(
      'We are a team and need a tracker.'
    )
  })

  test('ordinary words and feature labels are not brands; product names are', () => {
    const is = (name: string): boolean => ordinaryName(name, 'Acme', check)
    // Product names and names with the brand word.
    expect(['Acme', 'Acme Pay', 'Booker', 'Jira', 'Shop Pay', 'Atlas'].map(is)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false
    ])
    // Plan words, short acronyms, plurals, -ing words, lower-case phrases, words the pages use in lower case.
    expect(
      [
        'Premium',
        'Pro Plus',
        'CDP',
        'Surveys',
        'Tracing',
        'Data warehouse',
        'Storage',
        'Reminders'
      ].map(is)
    ).toEqual([true, true, true, true, true, true, true, true])
    // Without enough page text only the shape rules apply.
    expect(ordinaryName('Storage', 'Acme', null)).toBe(false)
    expect(ordinaryName('Surveys', 'Acme', null)).toBe(true)
    // A one-word family name that shares the brand's start stays.
    expect(ordinaryName('Freshsales', 'Freshworks', null)).toBe(false)
  })
})
