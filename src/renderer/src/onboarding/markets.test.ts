import { describe, expect, test } from 'vitest'
import {
  canonicalCountry,
  COUNTRY_OPTIONS,
  countryOptionsFor,
  flagFor,
  isListedCountry,
  LANGUAGE_OPTIONS,
  marketSummary,
  TOP_COUNTRY_OPTIONS,
  TOP_LANGUAGE_OPTIONS
} from './markets'
import { emptySetupDraft } from './setupDraft'

describe('country options', () => {
  test('lists the United Kingdom once, as GB', () => {
    const uk = COUNTRY_OPTIONS.filter((option) => option.label.includes('United Kingdom'))
    expect(uk).toEqual([{ value: 'GB', label: 'United Kingdom · GB 🇬🇧' }])
    expect(COUNTRY_OPTIONS.map((option) => option.value as string)).not.toContain('UK')
  })

  test('UK is an alias of GB', () => {
    expect(canonicalCountry('uk')).toBe('GB')
    expect(canonicalCountry(' gb ')).toBe('GB')
    expect(canonicalCountry('us')).toBe('US')
    expect(isListedCountry('UK')).toBe(true)
    expect(isListedCountry('FR')).toBe(true)
    expect(isListedCountry('ZZ')).toBe(false)
  })

  test('a stored UK keeps its code but shows the one United Kingdom row', () => {
    const options = countryOptionsFor('UK')
    expect(options.filter((option) => option.label.includes('United Kingdom'))).toEqual([
      { value: 'UK', label: 'United Kingdom · GB 🇬🇧' }
    ])
    expect(options).toHaveLength(COUNTRY_OPTIONS.length)
    // The shared list is not changed.
    expect(COUNTRY_OPTIONS.find((option) => option.value === 'GB')).toBeDefined()
  })

  test('a listed or empty value gives the plain list; an unlisted code is added', () => {
    expect(countryOptionsFor('GB')).toEqual(COUNTRY_OPTIONS.map((option) => ({ ...option })))
    expect(countryOptionsFor(null)).toHaveLength(COUNTRY_OPTIONS.length)
    expect(countryOptionsFor('ZZ').at(-1)).toEqual({ value: 'ZZ', label: 'ZZ' })
  })
})

describe('every country and language', () => {
  test('lists every country once, the most used first, the rest A to Z', () => {
    const values = COUNTRY_OPTIONS.map((option) => option.value)
    expect(values.length).toBeGreaterThan(230)
    expect(new Set(values).size).toBe(values.length)
    expect(values.slice(0, 3)).toEqual(['US', 'GB', 'CA'])
    const rest = COUNTRY_OPTIONS.slice(TOP_COUNTRY_OPTIONS.length).map(
      (option) => option.label.split(' · ')[0] ?? ''
    )
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')))
    expect(COUNTRY_OPTIONS).toContainEqual({ value: 'FR', label: 'France · FR 🇫🇷' })
    expect(COUNTRY_OPTIONS).toContainEqual({ value: 'JP', label: 'Japan · JP 🇯🇵' })
  })

  test('every language has a flag, English first', () => {
    expect(LANGUAGE_OPTIONS[0]).toEqual({ value: 'en', label: 'English · EN 🇺🇸' })
    expect(LANGUAGE_OPTIONS).toContainEqual({
      value: 'pt-BR',
      label: 'Portuguese (Brazil) · PT-BR 🇧🇷'
    })
    expect(TOP_LANGUAGE_OPTIONS.map((option) => option.value)).toContain('zh-CN')
    for (const option of LANGUAGE_OPTIONS) expect(option.label).toMatch(/ \p{RI}\p{RI}$/u)
    const values = LANGUAGE_OPTIONS.map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })

  test('flags for any code; UK shows the GB flag', () => {
    expect(flagFor('DE')).toBe('🇩🇪')
    expect(flagFor('UK')).toBe('🇬🇧')
    expect(flagFor('1')).toBe('')
    expect(marketSummary('FR', 'fr')).toBe('🇫🇷 FR · FR')
  })

  test('a new setup starts on the United States, in English', () => {
    const site = emptySetupDraft().site
    expect([site.country, site.language]).toEqual(['US', 'en'])
  })
})

describe('finding a country by typing', () => {
  test('lists India near the top, with its name first so typing "Ind" lands on it', () => {
    const india = COUNTRY_OPTIONS.find((option) => option.value === 'IN')
    expect(india).toEqual({ value: 'IN', label: 'India · IN 🇮🇳' })
    expect(COUNTRY_OPTIONS.indexOf(india!)).toBeLessThan(10)
  })

  test('starts every country and language label with its name (never a flag)', () => {
    for (const option of [...COUNTRY_OPTIONS, ...LANGUAGE_OPTIONS]) {
      expect(option.label).toMatch(/^\p{L}/u)
    }
  })

  test('has more than 200 countries and every label shows its flag at the end', () => {
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(200)
    expect(COUNTRY_OPTIONS.every((option) => /\p{Regional_Indicator}/u.test(option.label))).toBe(
      true
    )
  })
})
