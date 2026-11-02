import { cleanHost } from './competitor-hosts'
import type { SiteRole } from './site-role'
import { SITE_TYPES, type SiteType } from './site-type'
import { hostMatches } from './source-type'

/**
 * The user's own word on a cited site, per domain and per project: its type of site,
 * its role, or both. What the address says is only the start; the user may know
 * better (a vendor's blog that reads as a plain website, a forum on its own domain).
 * The order every sources list follows:
 *
 *   own site > user's override > competitor list > built-in platform list > Other / Neutral
 *
 * A type may also be one of the project's own custom types (`custom:<id>`).
 */

/** Types the user may pick. `yours` and `competitor` follow from the site and the list. */
export const PICKABLE_SITE_TYPES = SITE_TYPES.filter(
  (type): type is Exclude<SiteType, 'yours' | 'competitor'> =>
    type !== 'yours' && type !== 'competitor'
)

export type PickableSiteType = (typeof PICKABLE_SITE_TYPES)[number]

export const CUSTOM_TYPE_PREFIX = 'custom:'

/** A built-in type or a custom one (`custom:<id>`). */
export type SiteTypeChoice = PickableSiteType | `custom:${string}`

/** Colours a custom type may take: the chip tones. */
export const SITE_TYPE_TONES = ['neutral', 'info', 'ok', 'warn', 'bad', 'fox'] as const

export type SiteTypeTone = (typeof SITE_TYPE_TONES)[number]

export const SITE_TYPE_TONE_LABELS: Readonly<Record<SiteTypeTone, string>> = {
  neutral: 'Grey',
  info: 'Blue',
  ok: 'Green',
  warn: 'Amber',
  bad: 'Red',
  fox: 'Orange'
}

export const MAX_SITE_TYPE_NAME = 40
export const MAX_CUSTOM_SITE_TYPES = 40

/** A type of site the project added ("Partner", "Reseller"). */
export interface CustomSiteType {
  id: string
  name: string
  tone: SiteTypeTone
}

/** The user's choice for one domain. Null: automatic. */
export interface SiteOverride {
  domain: string
  type: SiteTypeChoice | null
  role: SiteRole | null
}

/** Everything the sources lists need to apply the user's choices. */
export interface SiteTypeSettings {
  overrides: readonly SiteOverride[]
  customTypes: readonly CustomSiteType[]
}

export const NO_SITE_TYPE_SETTINGS: SiteTypeSettings = { overrides: [], customTypes: [] }

export function isSiteTypeTone(value: unknown): value is SiteTypeTone {
  return typeof value === 'string' && (SITE_TYPE_TONES as readonly string[]).includes(value)
}

export function isPickableSiteType(value: unknown): value is PickableSiteType {
  return typeof value === 'string' && (PICKABLE_SITE_TYPES as readonly string[]).includes(value)
}

const CUSTOM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isSiteTypeChoice(value: unknown): value is SiteTypeChoice {
  if (isPickableSiteType(value)) return true
  return (
    typeof value === 'string' &&
    value.startsWith(CUSTOM_TYPE_PREFIX) &&
    CUSTOM_ID.test(value.slice(CUSTOM_TYPE_PREFIX.length))
  )
}

/** `custom:<id>` for a custom type's id. */
export function customTypeChoice(id: string): SiteTypeChoice {
  return `${CUSTOM_TYPE_PREFIX}${id}`
}

/** The custom type's id in a choice, or null for a built-in type. */
export function customTypeId(choice: SiteTypeChoice): string | null {
  return choice.startsWith(CUSTOM_TYPE_PREFIX) ? choice.slice(CUSTOM_TYPE_PREFIX.length) : null
}

/**
 * The override for a host: the one on its own domain, else the nearest parent domain
 * (`reddit.com` covers `old.reddit.com`). Null when the user set nothing.
 */
export function overrideFor(host: string, overrides: readonly SiteOverride[]): SiteOverride | null {
  const bare = cleanHost(host)
  let best: SiteOverride | null = null
  for (const override of overrides) {
    if (!hostMatches(bare, override.domain)) continue
    if (best === null || override.domain.length > best.domain.length) best = override
  }
  return best
}
