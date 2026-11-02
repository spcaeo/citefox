import {
  DEFAULT_INCLUDE_SUBDOMAINS,
  DEFAULT_MARKET_DEVICE,
  isCountryCode,
  isLanguageTag
} from '@shared/domain'
import type { SaveProfileRequest } from '@shared/ipc'

/**
 * Profile step validation (section 15, FR-1.1, FR-9.1, FR-9.3).
 * Country is ISO 3166-1 alpha-2; UK and GB are both accepted and stored as given.
 * Language is ISO 639-1 or BCP-47 with a lowercase primary subtag.
 */

export interface ProfileDraft {
  userName: string
  projectName: string
  domain: string
  brands: readonly string[]
  brandDraft: string
  competitors: readonly string[]
  competitorDraft: string
  /** "Use in buyer questions" picks: options buyers switch from (never competitors). */
  switchingFrom: readonly string[]
  /** "Note as integration" picks: tools buyers use with the product. */
  integrations: readonly string[]
  /** Select value, or `other` when the user types a code. */
  country: string
  countryCode: string
  /** Select value, or `other` when the user types a tag. */
  language: string
  languageCode: string
  location: string
}

export interface ProfileFieldErrors {
  userName?: string
  projectName?: string
  domain?: string
  brands?: string
  country?: string
  language?: string
}

export const PROFILE_COPY = {
  userName: 'Enter your name.',
  projectName: 'Enter a project name.',
  domainMissing: 'Enter your website’s domain, such as example.com.',
  domainInvalid: 'Enter a domain like example.com, without a path.',
  brands: 'Add at least one brand name.',
  country: 'Choose a country.',
  countryInvalid: 'Enter a two-letter country code. UK and GB are both accepted.',
  language: 'Choose a language.',
  languageInvalid: 'Enter a language code such as en or pt-BR.',
  budget: 'Enter a whole number of searches, or leave the budget empty for no cap.',
  serpApiKey: 'Paste your SerpApi key.'
} as const

export function emptyProfileDraft(): ProfileDraft {
  return {
    userName: '',
    projectName: '',
    domain: '',
    brands: [],
    brandDraft: '',
    competitors: [],
    competitorDraft: '',
    switchingFrom: [],
    integrations: [],
    country: '',
    countryCode: '',
    language: '',
    languageCode: '',
    location: ''
  }
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
}

export function isRegistrableDomain(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
}

/** Brand names keep the user's casing. Comparison is case-insensitive. */
export function normalizeBrand(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** Competitor chips follow the mock-up: lowercase, no scheme, no www, no path. */
export function normalizeCompetitor(value: string): string {
  return normalizeDomain(value)
}

export function normalizeCountry(value: string): string {
  return value.trim().toUpperCase()
}

/** Lowercase the primary subtag. Later subtags stay as typed (`pt-BR`). */
export function normalizeLanguageTag(value: string): string {
  const trimmed = value.trim()
  const parts = trimmed.split('-')
  const primary = parts[0]
  if (!primary) return ''
  const rest = parts.slice(1)
  const head = primary.toLowerCase()
  if (rest.length === 0) return head
  return [head, ...rest].join('-')
}

export function mergeChip(
  existing: readonly string[],
  draft: string,
  normalize: (value: string) => string
): readonly string[] {
  const next = normalize(draft)
  if (!next) return existing
  const exists = existing.some((item) => item.toLowerCase() === next.toLowerCase())
  if (exists) return existing
  return [...existing, next]
}

export function removeChip(existing: readonly string[], label: string): readonly string[] {
  return existing.filter((item) => item.toLowerCase() !== label.toLowerCase())
}

/**
 * Empty is no cap (`null`). A positive integer is the monthly search budget (FR-11.1).
 */
export function parseSearchBudget(
  value: string
): { cap: number | null } | { error: typeof PROFILE_COPY.budget } {
  const trimmed = value.trim()
  if (trimmed === '') return { cap: null }
  if (!/^[1-9]\d*$/.test(trimmed)) return { error: PROFILE_COPY.budget }
  const cap = Number(trimmed)
  if (!Number.isSafeInteger(cap)) return { error: PROFILE_COPY.budget }
  return { cap }
}

function countryFromDraft(draft: ProfileDraft): { raw: string; code: string } {
  const raw = draft.country === 'other' ? draft.countryCode : draft.country
  return { raw, code: normalizeCountry(raw) }
}

function languageFromDraft(draft: ProfileDraft): { raw: string; tag: string } {
  const raw = draft.language === 'other' ? draft.languageCode : draft.language
  return { raw, tag: normalizeLanguageTag(raw) }
}

export function validateProfile(
  draft: ProfileDraft
): { ok: true; request: SaveProfileRequest } | { ok: false; errors: ProfileFieldErrors } {
  const errors: ProfileFieldErrors = {}
  const userName = draft.userName.trim()
  const projectName = draft.projectName.trim()
  const domain = normalizeDomain(draft.domain)
  const brands = mergeChip(draft.brands, draft.brandDraft, normalizeBrand)
  const competitors = mergeChip(draft.competitors, draft.competitorDraft, normalizeCompetitor)
  const country = countryFromDraft(draft)
  const language = languageFromDraft(draft)

  if (!userName) errors.userName = PROFILE_COPY.userName
  if (!projectName) errors.projectName = PROFILE_COPY.projectName
  if (!draft.domain.trim()) errors.domain = PROFILE_COPY.domainMissing
  else if (!isRegistrableDomain(domain)) errors.domain = PROFILE_COPY.domainInvalid
  if (brands.length === 0) errors.brands = PROFILE_COPY.brands
  if (!country.raw.trim()) errors.country = PROFILE_COPY.country
  else if (!isCountryCode(country.code)) errors.country = PROFILE_COPY.countryInvalid
  if (!language.raw.trim()) errors.language = PROFILE_COPY.language
  else if (!isLanguageTag(language.tag)) errors.language = PROFILE_COPY.languageInvalid

  if (
    errors.userName ||
    errors.projectName ||
    errors.domain ||
    errors.brands ||
    errors.country ||
    errors.language
  ) {
    return { ok: false, errors }
  }

  const location = draft.location.trim()
  return {
    ok: true,
    request: {
      userName,
      projectName,
      domain,
      includeSubdomains: DEFAULT_INCLUDE_SUBDOMAINS,
      brandNames: brands,
      competitors,
      country: country.code,
      language: language.tag,
      location: location.length > 0 ? location : null,
      device: DEFAULT_MARKET_DEVICE,
      switchingFrom: draft.switchingFrom,
      integrations: draft.integrations
    }
  }
}
