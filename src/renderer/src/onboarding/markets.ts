import {
  ALL_COUNTRY_CODES,
  LANGUAGES,
  TOP_COUNTRIES,
  TOP_LANGUAGES,
  countryName,
  flagFor
} from './marketLists'

export { flagFor } from './marketLists'

/** The country every new market starts with. */
export const DEFAULT_COUNTRY = 'US'
/** The language every new market starts with. */
export const DEFAULT_LANGUAGE = 'en'

/**
 * "India · IN 🇮🇳". The name comes first on purpose: a dropdown finds an option by the first
 * letters of its text, so typing "Ind" must land on India. A flag in front would break that
 * (owner feedback 2026-11-03: "India is not in the countries"; it was, but typing found nothing).
 */
function countryOption(code: string): CountryOption {
  return { value: code, label: `${countryName(code)} · ${code} ${flagFor(code)}`.trim() }
}

function byLabelName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'en')
}

/** Where most buyers are, in this order. */
export const TOP_COUNTRY_OPTIONS: readonly CountryOption[] = TOP_COUNTRIES.map(countryOption)

/** Every other country, A to Z by name. */
export const OTHER_COUNTRY_OPTIONS: readonly CountryOption[] = ALL_COUNTRY_CODES.filter(
  (code) => !TOP_COUNTRIES.includes(code)
)
  .map((code) => ({ code, name: countryName(code) }))
  .sort(byLabelName)
  .map(({ code }) => countryOption(code))

/**
 * Options shown wherever a country is picked: the most used first, then
 * every other country A to Z. Values are the codes that are stored. The
 * United Kingdom is listed once, as its ISO code GB; see `countryOptionsFor`
 * for projects that stored the older alias UK.
 */
export const COUNTRY_OPTIONS: readonly CountryOption[] = [
  ...TOP_COUNTRY_OPTIONS,
  ...OTHER_COUNTRY_OPTIONS
]

function languageOption(code: string): CountryOption {
  const entry = LANGUAGES.find((language) => language.code === code)
  const name = entry?.name ?? code
  const flag = entry ? flagFor(entry.flag) : ''
  // Name first, so typing the language name finds it (see countryOption).
  return { value: code, label: `${name} · ${code.toUpperCase()} ${flag}`.trim() }
}

/** The most used languages, in this order. */
export const TOP_LANGUAGE_OPTIONS: readonly CountryOption[] = TOP_LANGUAGES.map(languageOption)

/** Every other language Google answers in, A to Z. */
export const OTHER_LANGUAGE_OPTIONS: readonly CountryOption[] = LANGUAGES.filter(
  (language) => !TOP_LANGUAGES.includes(language.code)
)
  .slice()
  .sort(byLabelName)
  .map((language) => languageOption(language.code))

/** Options shown wherever a language is picked: the most used first. */
export const LANGUAGE_OPTIONS: readonly CountryOption[] = [
  ...TOP_LANGUAGE_OPTIONS,
  ...OTHER_LANGUAGE_OPTIONS
]

export interface CountryOption {
  value: string
  label: string
}

/** Older codes that mean a listed country. Stored values keep working. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = { UK: 'GB' }

/** "uk" → "GB". Trims and uppercases, then resolves an alias. */
export function canonicalCountry(code: string): string {
  const upper = code.trim().toUpperCase()
  return COUNTRY_ALIASES[upper] ?? upper
}

/** True when the code (or its alias) is one of `COUNTRY_OPTIONS`. */
export function isListedCountry(code: string): boolean {
  const canonical = canonicalCountry(code)
  return COUNTRY_OPTIONS.some((option) => option.value === canonical)
}

/**
 * The country list for a select whose current value is `current`.
 * A stored alias (UK) takes the place of its country's row, so the select
 * shows "United Kingdom" once and saving unchanged keeps the stored code.
 * An unlisted code is added at the end as itself.
 */
export function countryOptionsFor(current: string | null | undefined): CountryOption[] {
  const value = (current ?? '').trim()
  const options: CountryOption[] = COUNTRY_OPTIONS.map((option) => ({ ...option }))
  if (value.length === 0) return options
  const canonical = canonicalCountry(value)
  const listed = options.find((option) => option.value === canonical)
  if (listed) {
    listed.value = value
    return options
  }
  return [...options, { value, label: value }]
}

/** FR-9.2 short codes, for example "🇺🇸 US · EN". */
export function marketSummary(country: string, language: string): string {
  const lang = language
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join('-')
  const code = `${country} · ${lang}`
  const flag = flagFor(country)
  return flag ? `${flag} ${code}` : code
}

/**
 * Small stand-in for SerpApi's location list (FR-9.5).
 * The engine does the real match on save. The mock uses the same table.
 */
const SERPAPI_LOCATIONS: Readonly<Record<string, string>> = {
  austin: 'Austin,Texas,United States',
  'austin, texas': 'Austin,Texas,United States',
  london: 'London,England,United Kingdom',
  'london, england': 'London,England,United Kingdom'
}

export function matchSerpApiLocation(location: string | null): string | null {
  if (!location) return null
  const key = location.trim().toLowerCase()
  if (!key) return null
  return SERPAPI_LOCATIONS[key] ?? null
}
