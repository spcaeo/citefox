import { isCountryCode, isLanguageTag, isMarketDevice } from '@shared/domain'
import type { Market, MarketDevice } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { recordTrackingChange } from './tracking-changes'
import { migrate } from './migrate'
import { PROJECT_MIGRATIONS } from './project-schema'
import { containsSecret } from '../logging/redact'
import { readBuyerContext, writeBuyerContext } from './buyer-context'
import { syncFlatCompetitors } from './products'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

/** Profile fields that live in the project database, not in settings.json. */
export interface ProjectProfile {
  includeSubdomains: boolean
  brandNames: readonly string[]
  competitors: readonly string[]
  market: Market
  /**
   * Options buyers switch from and integrations (Docs/FEEDBACK.md row 3), kept for
   * prompt writing, never as competitors. Always set on read; on write, omitted
   * leaves the stored notes as they are.
   */
  switchingFrom?: readonly string[]
  integrations?: readonly string[]
}

export function ensureProjectSchema(db: SqliteDatabase): void {
  migrate(db, PROJECT_MIGRATIONS)
}

export function readProjectProfile(db: SqliteDatabase): ProjectProfile | null {
  ensureProjectSchema(db)
  const settings = db
    .prepare<unknown[], SettingsSql>(
      `SELECT include_subdomains, brand_names, competitors FROM project_settings WHERE id = 1`
    )
    .get()
  const market = db
    .prepare<unknown[], MarketSql>(
      `SELECT id, country, language, location, device, local_wording, serpapi_location
       FROM markets WHERE is_default = 1 ORDER BY rowid ASC LIMIT 1`
    )
    .get()
  if (settings === undefined || market === undefined) return null
  return {
    includeSubdomains: settings.include_subdomains === 1,
    brandNames: parseNameList(settings.brand_names, 'brand names'),
    competitors: parseNameList(settings.competitors, 'competitors'),
    market: marketFromSql(market),
    ...readBuyerContext(db)
  }
}

export function getMarket(db: SqliteDatabase, id: string): Market | null {
  ensureProjectSchema(db)
  if (!ID.test(id)) throw new StorageError('Invalid market id')
  const row = db
    .prepare<unknown[], MarketSql>(
      `SELECT id, country, language, location, device, local_wording, serpapi_location
       FROM markets WHERE id = ?`
    )
    .get(id)
  return row === undefined ? null : marketFromSql(row)
}

export function listMarkets(db: SqliteDatabase): Market[] {
  ensureProjectSchema(db)
  return db
    .prepare<unknown[], MarketSql>(
      `SELECT id, country, language, location, device, local_wording, serpapi_location
       FROM markets ORDER BY is_default DESC, rowid ASC`
    )
    .all()
    .map((row) => marketFromSql(row))
}

/**
 * Makes an existing market row the project's default for new pages. The row's
 * fields stay as they are, so pages linked to it keep their market.
 */
export function setDefaultMarketRow(db: SqliteDatabase, marketId: string): void {
  ensureProjectSchema(db)
  if (!ID.test(marketId)) throw new StorageError('Invalid market id')
  const write = db.transaction(() => {
    const found = db.prepare(`SELECT id FROM markets WHERE id = ?`).get(marketId)
    if (found === undefined) throw new StorageError('Unknown market')
    db.prepare(`UPDATE markets SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END`).run(marketId)
  })
  write()
}

/** Adds a market without replacing the profile. The default market stays the one already stored. */
export function insertMarket(db: SqliteDatabase, market: Market): void {
  ensureProjectSchema(db)
  const row = normalizeMarket(market)
  try {
    db.prepare(
      `INSERT INTO markets (
         id, country, language, location, device, local_wording, serpapi_location, is_default
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      row.id,
      row.country,
      row.language,
      row.location,
      row.device,
      row.localWording ? 1 : 0,
      row.serpapiLocation
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save market')
  }
  recordTrackingChange(db, {
    at: new Date().toISOString(),
    kind: 'market_added',
    detail: `${row.country} · ${row.language.toUpperCase()}`
  })
}

export function writeProjectProfile(db: SqliteDatabase, profile: ProjectProfile): void {
  ensureProjectSchema(db)
  const includeSubdomains = profile.includeSubdomains ? 1 : 0
  const brandNames = normalizeNameList(profile.brandNames, 'brand name', true)
  const competitors = normalizeNameList(profile.competitors, 'competitor', false)
  const market = normalizeMarket(profile.market)
  const write = db.transaction(() => {
    db.prepare(`DELETE FROM project_settings WHERE id = 1`).run()
    db.prepare(`DELETE FROM markets`).run()
    writeBuyerContext(db, profile)
    db.prepare(
      `INSERT INTO project_settings (id, include_subdomains, brand_names, competitors)
       VALUES (1, ?, ?, ?)`
    ).run(includeSubdomains, JSON.stringify(brandNames), JSON.stringify(competitors))
    syncFlatCompetitors(db, competitors)
    db.prepare(
      `INSERT INTO markets (
         id, country, language, location, device, local_wording, serpapi_location, is_default
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      market.id,
      market.country,
      market.language,
      market.location,
      market.device,
      market.localWording ? 1 : 0,
      market.serpapiLocation
    )
  })
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save project profile')
  }
}

/**
 * Updates the profile and the default market in place.
 * Other market rows stay, so page links are not dropped.
 */
export function updateProjectProfile(db: SqliteDatabase, profile: ProjectProfile): void {
  ensureProjectSchema(db)
  const includeSubdomains = profile.includeSubdomains ? 1 : 0
  const brandNames = normalizeNameList(profile.brandNames, 'brand name', true)
  const competitors = normalizeNameList(profile.competitors, 'competitor', false)
  const market = normalizeMarket(profile.market)
  const write = db.transaction(() => {
    writeBuyerContext(db, profile)
    const settings = db.prepare(`SELECT id FROM project_settings WHERE id = 1`).get()
    if (settings === undefined) {
      db.prepare(
        `INSERT INTO project_settings (id, include_subdomains, brand_names, competitors)
         VALUES (1, ?, ?, ?)`
      ).run(includeSubdomains, JSON.stringify(brandNames), JSON.stringify(competitors))
    } else {
      db.prepare(
        `UPDATE project_settings
         SET include_subdomains = ?, brand_names = ?, competitors = ?
         WHERE id = 1`
      ).run(includeSubdomains, JSON.stringify(brandNames), JSON.stringify(competitors))
    }
    syncFlatCompetitors(db, competitors)
    db.prepare(`UPDATE markets SET is_default = 0`).run()
    const existing = db.prepare(`SELECT id FROM markets WHERE id = ?`).get(market.id)
    if (existing === undefined) {
      db.prepare(
        `INSERT INTO markets (
           id, country, language, location, device, local_wording, serpapi_location, is_default
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      ).run(
        market.id,
        market.country,
        market.language,
        market.location,
        market.device,
        market.localWording ? 1 : 0,
        market.serpapiLocation
      )
      return
    }
    db.prepare(
      `UPDATE markets SET
         country = ?, language = ?, location = ?, device = ?, local_wording = ?,
         serpapi_location = ?, is_default = 1
       WHERE id = ?`
    ).run(
      market.country,
      market.language,
      market.location,
      market.device,
      market.localWording ? 1 : 0,
      market.serpapiLocation,
      market.id
    )
  })
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save project profile')
  }
}

interface SettingsSql {
  include_subdomains: number
  brand_names: string
  competitors: string
}

interface MarketSql {
  id: string
  country: string
  language: string
  location: string | null
  device: string
  local_wording: number
  serpapi_location: string | null
}

function marketFromSql(row: MarketSql): Market {
  return normalizeMarket({
    id: row.id,
    country: row.country,
    language: row.language,
    location: row.location,
    device: requireDevice(row.device),
    localWording: row.local_wording === 1,
    serpapiLocation: row.serpapi_location
  })
}

function normalizeMarket(market: Market): Market {
  if (!ID.test(market.id)) throw new StorageError('Invalid market id')
  if (!isCountryCode(market.country)) throw new StorageError('Invalid country')
  if (!isLanguageTag(market.language)) throw new StorageError('Invalid language')
  const location = normalizeLocation(market.location)
  const serpapiLocation =
    market.serpapiLocation === null
      ? null
      : requireLabel(market.serpapiLocation, 'serpapi location', 120)
  return {
    id: market.id,
    country: market.country,
    language: market.language,
    location,
    device: requireDevice(market.device),
    localWording: market.localWording,
    serpapiLocation
  }
}

function normalizeLocation(value: string | null): string | null {
  if (value === null) return null
  return requireLabel(value, 'location', 120)
}

function requireDevice(value: string): MarketDevice {
  if (!isMarketDevice(value)) throw new StorageError('Invalid device')
  return value
}

function normalizeNameList(values: readonly string[], label: string, required: boolean): string[] {
  if (!Array.isArray(values)) throw new StorageError(`Invalid ${label}`)
  if (required && values.length === 0) throw new StorageError(`Invalid ${label}`)
  const seen = new Set<string>()
  const names: string[] = []
  for (const value of values) {
    const name = requireLabel(value, label, 80)
    if (seen.has(name)) throw new StorageError(`Invalid ${label}`)
    seen.add(name)
    names.push(name)
  }
  return names
}

function parseNameList(json: string, label: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    throw new StorageError(`Invalid ${label}`)
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new StorageError(`Invalid ${label}`)
  }
  return parsed
}

function requireLabel(value: string, label: string, max: number): string {
  if (value.length === 0 || value.length > max || value.trim() !== value) {
    throw new StorageError(`Invalid ${label}`)
  }
  if (hasControlCharacter(value)) throw new StorageError(`Invalid ${label}`)
  if (containsSecret(value)) throw new StorageError(`${label} cannot contain a secret`)
  return value
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
