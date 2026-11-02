/** Projects, markets, and the site pages fill-from-website reads. */

import { isOneOf } from './one-of'

const PROJECT_STATUSES = ['active', 'paused', 'archived'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** FR-9.1. */
const MARKET_DEVICES = ['desktop', 'mobile'] as const

export type MarketDevice = (typeof MARKET_DEVICES)[number]

/**
 * FR-1.8. Which site page a fill attempt refers to: one of the four fixed pages, or
 * `page`, an offering page the home page links to (a use case, an integration).
 */
const WEBSITE_PAGE_ROLES = ['home', 'pricing', 'about', 'compare', 'page'] as const

export type WebsitePageRole = (typeof WEBSITE_PAGE_ROLES)[number]

/** Phases pushed on `projects:fillProgress`. */
const FILL_PHASES = ['fetch', 'suggest'] as const

export type FillPhase = (typeof FILL_PHASES)[number]

/** CEO decision. The profile step does not ask for a device. */
export const DEFAULT_MARKET_DEVICE: MarketDevice = 'desktop'

/** CEO decision. The profile step does not show a subdomain control. */
export const DEFAULT_INCLUDE_SUBDOMAINS = true

/** `projects` row used by the project list and switcher (FR-10.1). */
export interface ProjectSummary {
  id: string
  name: string
  slug: string
  domain: string
  dbPath: string
  clientName: string | null
  status: ProjectStatus
}

/**
 * `markets` row (FR-9.1).
 * `country` is stored uppercase in the alpha-2 shape (`US`, `GB`, `UK`).
 * `language` is an ISO 639-1 tag or a BCP-47 tag (`en`, `pt-BR`).
 * They map to SerpApi `gl` and `hl`. Display labels are derived in the UI.
 * `location` is the optional city or region. `serpapiLocation` is the name
 * matched from SerpApi's location list (FR-9.5), or null when it is not matched yet.
 */
export interface Market {
  id: string
  country: string
  language: string
  location: string | null
  device: MarketDevice
  localWording: boolean
  serpapiLocation: string | null
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return isOneOf(PROJECT_STATUSES, value)
}

export function isMarketDevice(value: string): value is MarketDevice {
  return isOneOf(MARKET_DEVICES, value)
}

/**
 * Two uppercase letters, the shape of an ISO 3166-1 alpha-2 code.
 * This is not a registry check. `UK` passes: it is exceptionally reserved,
 * and SerpApi's Google `gl` example for the United Kingdom is `uk`.
 * The officially assigned code is `GB`. The stored value is lowercased for `gl`.
 */
export function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value)
}

/**
 * SerpApi's Google `gl` for a stored country code. SerpApi lists the United
 * Kingdom as `uk`, so both GB (the ISO code the app now offers) and the older
 * stored alias UK search as `uk`. Every other code is lowercased.
 */
export function serpApiGl(country: string): string {
  const code = country.trim().toLowerCase()
  return code === 'gb' ? 'uk' : code
}

/**
 * ISO 639-1 primary subtag, or a BCP-47 tag whose primary subtag is lowercase.
 * This checks the shape only. It does not look the tag up in a registry.
 */
export function isLanguageTag(value: string): boolean {
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
}

export function isWebsitePageRole(value: string): value is WebsitePageRole {
  return isOneOf(WEBSITE_PAGE_ROLES, value)
}

export function isFillPhase(value: string): value is FillPhase {
  return isOneOf(FILL_PHASES, value)
}
