import type { Market, MarketDevice } from '@shared/domain'
import type { MarketDraft, ProjectMarketPage, ProjectMarketsView } from '@shared/ipc'
import { canonicalCountry, COUNTRY_OPTIONS, DEFAULT_COUNTRY } from '../onboarding/markets'

type MarketFields = Pick<Market, 'country' | 'language' | 'location' | 'device'>

/** The language a country's market starts with in the Add market form. */
const COUNTRY_LANGUAGE: Readonly<Record<string, string>> = {
  US: 'en',
  GB: 'en',
  CA: 'en',
  AU: 'en',
  IN: 'en',
  MX: 'es'
}

/** The language a country's market usually starts with ("MX" → "es"), or null. */
export function usualLanguage(country: string): string | null {
  return COUNTRY_LANGUAGE[canonicalCountry(country)] ?? null
}

function sameLocation(left: string | null, right: string | null): boolean {
  return (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase()
}

/** True when `draft` is one of `markets` (country alias, language, city and device). */
export function isTrackedMarket(draft: MarketFields, markets: readonly MarketFields[]): boolean {
  return markets.some(
    (market) =>
      canonicalCountry(market.country) === canonicalCountry(draft.country) &&
      market.language.toLowerCase() === draft.language.toLowerCase() &&
      sameLocation(market.location, draft.location) &&
      market.device === draft.device
  )
}

/** Countries with at least one tracked market (any language, city or device). */
export function trackedCountries(markets: readonly MarketFields[]): Set<string> {
  return new Set(markets.map((market) => canonicalCountry(market.country)))
}

/**
 * The country and language the Add market form starts on: the first listed
 * country that is not tracked yet in its usual language on desktop (deep audit
 * page X14), so the form never opens on a market the project already has.
 */
export function untrackedDefault(markets: readonly MarketFields[]): {
  country: string
  language: string
} {
  for (const option of COUNTRY_OPTIONS) {
    const language = COUNTRY_LANGUAGE[option.value] ?? 'en'
    const draft = { country: option.value, language, location: null, device: 'desktop' as const }
    if (!isTrackedMarket(draft, markets)) return { country: option.value, language }
  }
  return { country: DEFAULT_COUNTRY, language: COUNTRY_LANGUAGE[DEFAULT_COUNTRY] ?? 'en' }
}

export function draftOf(market: Market): MarketDraft {
  return {
    country: market.country,
    language: market.language,
    location: market.location,
    device: market.device,
    localWording: market.localWording
  }
}

export interface MarketForm {
  country: string
  language: string
  city: string
  device: MarketDevice
}

export function draftFromMarketForm(form: MarketForm): MarketDraft {
  const city = form.city.trim()
  return {
    country: form.country,
    language: form.language,
    location: city.length === 0 ? null : city,
    device: form.device,
    localWording: false
  }
}

/** The market of `view` with these fields, or null. */
export function findMarket(view: ProjectMarketsView, draft: MarketFields): Market | null {
  return view.markets.find((market) => isTrackedMarket(draft, [market])) ?? null
}

/** Pages and topics of `view` that are checked in `marketId`. */
export function pagesIn(view: ProjectMarketsView, marketId: string): ProjectMarketPage[] {
  return view.pages.filter((page) => page.marketIds.includes(marketId))
}

/**
 * Searches the market adds to one full check of `pages`: questions × samples per
 * page that does not have it yet; up to twice that (section 6.1).
 */
export function addedSearches(
  pages: readonly ProjectMarketPage[],
  existingId: string | null
): { min: number; max: number; pages: number } {
  let min = 0
  let count = 0
  for (const page of pages) {
    if (existingId !== null && page.marketIds.includes(existingId)) continue
    min += page.questions * page.samples
    count += 1
  }
  return { min, max: min * 2, pages: count }
}

export function countText(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** "3 pages and 1 topic", "2 pages", "1 topic". */
export function pagesText(pages: readonly Pick<ProjectMarketPage, 'kind'>[]): string {
  const topics = pages.filter((page) => page.kind === 'topic').length
  const plain = pages.length - topics
  if (topics === 0) return countText(plain, 'page', 'pages')
  if (plain === 0) return countText(topics, 'topic', 'topics')
  return `${countText(plain, 'page', 'pages')} and ${countText(topics, 'topic', 'topics')}`
}
