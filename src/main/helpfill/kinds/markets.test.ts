import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SEED, seedAssistProject, type AssistSeed } from '../../assist/assist.test-helper'
import { cleanMarket, languageCode, marketKey } from './markets'

/**
 * Add market → ✦ Help me fill this, through the real `helpfill:*` handlers on the
 * seeded TextBolt project (US and UK · London, both on page-1). Claude is the
 * scripted stand-in: Describe's `markets.suggest` call is answered from
 * src/main/assist/fixtures/markets.suggest.json.
 */

let seed: AssistSeed

beforeEach(async () => {
  seed = await seedAssistProject()
})

afterEach(() => {
  seed.close()
})

/** A ChatGPT-style answer: chatter, a fenced CSV, a tracked market, a repeat and a list-style row. */
const ANSWER = `Sure! Here are some markets worth adding:

\`\`\`csv
country,language,city
Canada,English,Toronto
GB,en,London
CA,en,toronto
AU,EN,
Mexico,Spanish,none
\`\`\`

Let me know if you want more.`

describe('markets kind', () => {
  test('the prompt lists the tracked markets and asks for country,language,city', async () => {
    const result = await seed.handlers['helpfill:prompt']({
      kind: 'markets',
      projectId: SEED.projectId,
      scope: { pageId: null },
      count: null
    })
    expect(result.columns).toEqual(['country', 'language', 'city'])
    expect(result.tracked).toBe(2)
    expect(result.prompt.split('\n')[0]).toBe(
      'You help a company choose the countries, languages and cities where its buyers search Google.'
    )
    expect(result.prompt).toContain('Suggest 8 new markets')
    expect(result.prompt).toContain('Reply with CSV only, this header:\ncountry,language,city')
    expect(result.prompt).toContain('- US · en')
    expect(result.prompt).toContain('- UK · en · London')
    expect(result.prompt).not.toMatch(/@|\/Users\//u)
  })

  test('a pasted answer: codes cleaned, tracked and repeated markets merged', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'markets',
      projectId: SEED.projectId,
      scope: { pageId: SEED.pageId },
      text: ANSWER
    })
    expect(result.rows.map((row) => row.values)).toEqual([
      { country: 'CA', language: 'en', city: 'Toronto' },
      { country: 'AU', language: 'en', city: '' },
      { country: 'MX', language: 'es', city: '' }
    ])
    // GB · London is the tracked UK · London; CA · toronto repeats Canada · Toronto.
    expect(result.counts).toMatchObject({ read: 5, tracked: 1, repeats: 1, ready: 3, setAside: 0 })
    expect(result.noun).toEqual(['market', 'markets'])
  })

  test('a location or "City or area" header lands in city; a plain list is split', async () => {
    const table = await seed.handlers['helpfill:read']({
      kind: 'markets',
      projectId: SEED.projectId,
      scope: { pageId: null },
      text: '| Country | Language | City or area |\n|---|---|---|\n| India | Hindi | Mumbai |'
    })
    expect(table.rows[0]?.values).toEqual({ country: 'IN', language: 'hi', city: 'Mumbai' })
    const csv = await seed.handlers['helpfill:read']({
      kind: 'markets',
      projectId: SEED.projectId,
      scope: { pageId: null },
      text: 'country,language,location\nDE,de,Berlin'
    })
    expect(csv.rows[0]?.values).toEqual({ country: 'DE', language: 'de', city: 'Berlin' })
    const list = await seed.handlers['helpfill:read']({
      kind: 'markets',
      projectId: SEED.projectId,
      scope: { pageId: null },
      text: '1. Canada · English · Toronto\n2. France · French'
    })
    expect(list.rows.map((row) => row.values)).toEqual([
      { country: 'CA', language: 'en', city: 'Toronto' },
      { country: 'FR', language: 'fr', city: '' }
    ])
  })

  test('Describe runs markets.suggest with the sentence and splits its items', async () => {
    const sentence = 'We sell to offices in English-speaking countries'
    const result = await seed.handlers['helpfill:describe']({
      kind: 'markets',
      projectId: SEED.projectId,
      scope: { pageId: SEED.pageId },
      sentence,
      count: 3
    })
    const request = seed.claude.requests.at(-1)
    expect(request?.prompt.startsWith('Assist: markets.suggest')).toBe(true)
    expect(request?.prompt).toContain(sentence)
    expect(result.rows.map((row) => row.values)).toEqual([
      { country: 'CA', language: 'en', city: 'Toronto' },
      { country: 'AU', language: 'en', city: 'Sydney' }
    ])
  })

  test('estimate: Describe is offered with its cost', async () => {
    const estimate = await seed.handlers['helpfill:estimate']({
      kind: 'markets',
      projectId: SEED.projectId
    })
    expect(estimate).toMatchObject({ available: true, calls: 1 })
  })
})

describe('cleanMarket', () => {
  test('codes, names and blanks', () => {
    expect(
      cleanMarket({ country: 'United States', language: 'English (US)', city: 'All' })
    ).toEqual({ country: 'US', language: 'en', city: '' })
    expect(cleanMarket({ country: 'uk', language: 'en-GB', city: '(London)' })).toEqual({
      country: 'GB',
      language: 'en',
      city: 'London'
    })
    expect(cleanMarket({ country: 'Atlantis', language: 'en', city: '' })).toBeNull()
    expect(cleanMarket({ country: 'Canada | French | Montreal' })).toEqual({
      country: 'CA',
      language: 'fr',
      city: 'Montreal'
    })
  })

  test('languageCode and marketKey', () => {
    expect(languageCode('Spanish')).toBe('es')
    expect(languageCode('pt_BR')).toBe('pt')
    expect(languageCode('Klingon')).toBeNull()
    expect(marketKey({ country: 'UK', language: 'en', city: 'London' })).toBe(
      marketKey({ country: 'GB', language: 'EN-gb', city: 'london' })
    )
    expect(marketKey({ country: 'US', language: 'en', city: '' })).not.toBe(
      marketKey({ country: 'US', language: 'es', city: '' })
    )
  })
})
