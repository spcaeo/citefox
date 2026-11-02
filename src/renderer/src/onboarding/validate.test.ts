import { describe, expect, test } from 'vitest'
import { formatStoredKeyHint } from './hint'
import {
  PROFILE_COPY,
  emptyProfileDraft,
  mergeChip,
  normalizeBrand,
  normalizeCompetitor,
  normalizeCountry,
  normalizeLanguageTag,
  parseSearchBudget,
  validateProfile,
  type ProfileDraft
} from './validate'

function draft(overrides: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
    ...emptyProfileDraft(),
    userName: 'Rakesh',
    projectName: 'TextBolt',
    domain: 'textbolt.com',
    brands: ['TextBolt'],
    country: 'US',
    language: 'en',
    ...overrides
  }
}

describe('validateProfile', () => {
  test('requires a name, project, domain, brand, country, and language', () => {
    const result = validateProfile(emptyProfileDraft())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual({
      userName: PROFILE_COPY.userName,
      projectName: PROFILE_COPY.projectName,
      domain: PROFILE_COPY.domainMissing,
      brands: PROFILE_COPY.brands,
      country: PROFILE_COPY.country,
      language: PROFILE_COPY.language
    })
  })

  test('uses the mock-up brand error when the list is empty', () => {
    const result = validateProfile(draft({ brands: [], brandDraft: '   ' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.brands).toBe('Add at least one brand name.')
  })

  test('accepts a typed brand that has not been added yet', () => {
    const result = validateProfile(draft({ brands: [], brandDraft: 'TextBolt' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.brandNames).toEqual(['TextBolt'])
  })

  test('normalizes the domain and stores desktop with subdomains included', () => {
    const result = validateProfile(
      draft({ domain: 'https://www.TextBolt.com/pricing', location: '  ' })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.domain).toBe('textbolt.com')
    expect(result.request.includeSubdomains).toBe(true)
    expect(result.request.device).toBe('desktop')
    expect(result.request.location).toBeNull()
    expect(result.request.competitors).toEqual([])
  })

  test('rejects a domain that is only a path', () => {
    const result = validateProfile(draft({ domain: 'not a domain' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.domain).toBe(PROFILE_COPY.domainInvalid)
  })

  test('stores UK and GB as given', () => {
    const uk = validateProfile(draft({ country: 'UK' }))
    const gb = validateProfile(draft({ country: 'other', countryCode: 'gb' }))
    expect(uk.ok && uk.request.country).toBe('UK')
    expect(gb.ok && gb.request.country).toBe('GB')
  })

  test('rejects a country that is not two letters', () => {
    const result = validateProfile(draft({ country: 'other', countryCode: 'USA' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.country).toBe(PROFILE_COPY.countryInvalid)
  })

  test('accepts ISO 639-1 and BCP-47 language tags', () => {
    const en = validateProfile(draft({ language: 'EN' }))
    const pt = validateProfile(draft({ language: 'other', languageCode: 'pt-BR' }))
    expect(en.ok && en.request.language).toBe('en')
    expect(pt.ok && pt.request.language).toBe('pt-BR')
  })

  test('rejects a language with an underscore', () => {
    const result = validateProfile(draft({ language: 'other', languageCode: 'en_US' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.language).toBe(PROFILE_COPY.languageInvalid)
  })

  test('normalizes competitors the way the mock-up does', () => {
    expect(normalizeCompetitor('https://www.Twilio.com/docs')).toBe('twilio.com')
    const result = validateProfile(
      draft({ competitors: [], competitorDraft: 'https://www.Twilio.com/docs' })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.competitors).toEqual(['twilio.com'])
  })
})

describe('chips, codes, and budget', () => {
  test('ignores a duplicate brand regardless of case', () => {
    expect(mergeChip(['TextBolt'], ' textbolt ', normalizeBrand)).toEqual(['TextBolt'])
  })

  test('uppercases a country and lowercases a language primary subtag', () => {
    expect(normalizeCountry(' uk ')).toBe('UK')
    expect(normalizeLanguageTag('PT-br')).toBe('pt-br')
  })

  test('treats an empty budget as no cap and rejects zero', () => {
    expect(parseSearchBudget('')).toEqual({ cap: null })
    expect(parseSearchBudget('250')).toEqual({ cap: 250 })
    expect(parseSearchBudget('0')).toEqual({ error: PROFILE_COPY.budget })
    expect(parseSearchBudget('12.5')).toEqual({ error: PROFILE_COPY.budget })
  })
})

describe('formatStoredKeyHint', () => {
  test('adds a bullet mask only when a tail came back', () => {
    expect(formatStoredKeyHint('b1f4')).toBe('••••b1f4')
    expect(formatStoredKeyHint('')).toBeNull()
    expect(formatStoredKeyHint(null)).toBeNull()
    expect(formatStoredKeyHint(undefined)).toBeNull()
  })
})
