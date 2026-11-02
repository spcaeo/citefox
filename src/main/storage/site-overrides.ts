import { cleanHost } from '@shared/competitor-hosts'
import { isSiteRole, type SiteRole } from '@shared/site-role'
import {
  customTypeChoice,
  customTypeId,
  isSiteTypeChoice,
  isSiteTypeTone,
  MAX_CUSTOM_SITE_TYPES,
  MAX_SITE_TYPE_NAME,
  type CustomSiteType,
  type SiteOverride,
  type SiteTypeChoice,
  type SiteTypeSettings,
  type SiteTypeTone
} from '@shared/site-overrides'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { requireUtcTimestamp, runWrite } from './record-values'

/**
 * `site_overrides` and `custom_site_types` in the project database (project migration
 * 048): the type of site and role the user set per domain, and the project's own types.
 * A row with an unknown value is left out on read. A project file written before the
 * tables reads as empty.
 */

interface OverrideSql {
  domain: string
  site_type: string | null
  role: string | null
}

interface CustomTypeSql {
  id: string
  name: string
  tone: string
}

/** A change to one domain. Absent: unchanged. Null: back to automatic. */
export interface SiteOverrideChange {
  domain: string
  type?: SiteTypeChoice | null
  role?: SiteRole | null
}

/** The domain's override before and after a change (null: automatic). */
export interface SiteOverrideResult {
  previous: SiteOverride | null
  override: SiteOverride | null
}

/** Every override and custom type of the project. */
export function readSiteTypeSettings(db: SqliteDatabase): SiteTypeSettings {
  try {
    const customTypes = readCustomTypes(db)
    const known = new Set(customTypes.map((type) => customTypeChoice(type.id)))
    const overrides = db
      .prepare<unknown[], OverrideSql>(
        'SELECT domain, site_type, role FROM site_overrides ORDER BY domain'
      )
      .all()
      .flatMap((row) => {
        const override = overrideOf(row)
        if (override === null) return []
        // A custom type deleted under the row reads as automatic.
        if (override.type !== null && customTypeId(override.type) !== null) {
          if (!known.has(override.type)) override.type = null
        }
        return override.type === null && override.role === null ? [] : [override]
      })
    return { overrides, customTypes }
  } catch {
    // A project file written before migration 048: nothing is set yet.
    return { overrides: [], customTypes: [] }
  }
}

/** Sets or clears the type and role of one domain. A row left with neither is deleted. */
export function setSiteOverride(
  db: SqliteDatabase,
  change: SiteOverrideChange,
  now: string
): SiteOverrideResult {
  const at = requireUtcTimestamp(now)
  const domain = cleanHost(change.domain)
  if (domain.length === 0 || domain.length > 253) throw new StorageError('Invalid domain')
  if (change.type !== undefined && change.type !== null && !isSiteTypeChoice(change.type)) {
    throw new StorageError('Invalid site type')
  }
  if (change.role !== undefined && change.role !== null && !isSiteRole(change.role)) {
    throw new StorageError('Invalid role')
  }
  let result: SiteOverrideResult = { previous: null, override: null }
  runWrite(
    () =>
      db.transaction(() => {
        const row = db
          .prepare<unknown[], OverrideSql>(
            'SELECT domain, site_type, role FROM site_overrides WHERE domain = ?'
          )
          .get(domain)
        const previous = row === undefined ? null : overrideOf(row)
        const type = change.type === undefined ? (previous?.type ?? null) : change.type
        const role = change.role === undefined ? (previous?.role ?? null) : change.role
        const id = type === null ? null : customTypeId(type)
        if (id !== null && !customTypeExists(db, id)) {
          throw new StorageError('That type of site no longer exists')
        }
        if (type === null && role === null) {
          db.prepare('DELETE FROM site_overrides WHERE domain = ?').run(domain)
          result = { previous, override: null }
          return
        }
        db.prepare(
          `INSERT OR REPLACE INTO site_overrides (domain, site_type, role, updated_at)
           VALUES (?, ?, ?, ?)`
        ).run(domain, type, role, at)
        result = { previous, override: { domain, type, role } }
      })(),
    'Could not save the type of site'
  )
  return result
}

/** Adds a custom type (`id` new) or renames and recolours one. Names are unique, any case. */
export function saveCustomSiteType(
  db: SqliteDatabase,
  type: CustomSiteType,
  now: string
): CustomSiteType {
  const at = requireUtcTimestamp(now)
  const name = type.name.replace(/\s+/gu, ' ').trim()
  if (name.length === 0 || name.length > MAX_SITE_TYPE_NAME) {
    throw new StorageError('Invalid type name')
  }
  if (!isSiteTypeTone(type.tone)) throw new StorageError('Invalid colour')
  runWrite(
    () =>
      db.transaction(() => {
        const clash = db
          .prepare<unknown[], { id: string }>(
            'SELECT id FROM custom_site_types WHERE name = ? COLLATE NOCASE AND id <> ?'
          )
          .get(name, type.id)
        if (clash !== undefined) throw new StorageError(`There is already a type called ${name}`)
        if (customTypeExists(db, type.id)) {
          db.prepare('UPDATE custom_site_types SET name = ?, tone = ? WHERE id = ?').run(
            name,
            type.tone,
            type.id
          )
          return
        }
        const count = db
          .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM custom_site_types')
          .get()
        if ((count?.count ?? 0) >= MAX_CUSTOM_SITE_TYPES) {
          throw new StorageError(
            `A project can have up to ${MAX_CUSTOM_SITE_TYPES} types of its own`
          )
        }
        db.prepare(
          `INSERT INTO custom_site_types (id, name, tone, position, created_at)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM custom_site_types), ?)`
        ).run(type.id, name, type.tone, at)
      })(),
    'Could not save the type'
  )
  return { id: type.id, name, tone: type.tone }
}

/**
 * Deletes a custom type. The domains that had it go back to the automatic type (a
 * role set on them stays). Returns how many domains changed.
 */
export function removeCustomSiteType(db: SqliteDatabase, id: string): number {
  let cleared = 0
  runWrite(
    () =>
      db.transaction(() => {
        if (!customTypeExists(db, id)) throw new StorageError('That type of site no longer exists')
        const choice = customTypeChoice(id)
        cleared = db
          .prepare(
            'UPDATE site_overrides SET site_type = NULL WHERE site_type = ? AND role IS NOT NULL'
          )
          .run(choice).changes
        cleared += db.prepare('DELETE FROM site_overrides WHERE site_type = ?').run(choice).changes
        db.prepare('DELETE FROM custom_site_types WHERE id = ?').run(id)
      })(),
    'Could not delete the type'
  )
  return cleared
}

function readCustomTypes(db: SqliteDatabase): CustomSiteType[] {
  return db
    .prepare<unknown[], CustomTypeSql>(
      'SELECT id, name, tone FROM custom_site_types ORDER BY position, name'
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      tone: isSiteTypeTone(row.tone) ? row.tone : ('neutral' satisfies SiteTypeTone)
    }))
}

function customTypeExists(db: SqliteDatabase, id: string): boolean {
  return (
    db
      .prepare<unknown[], { id: string }>('SELECT id FROM custom_site_types WHERE id = ?')
      .get(id) !== undefined
  )
}

function overrideOf(row: OverrideSql): SiteOverride | null {
  const type = row.site_type !== null && isSiteTypeChoice(row.site_type) ? row.site_type : null
  const role = row.role !== null && isSiteRole(row.role) ? row.role : null
  return type === null && role === null ? null : { domain: row.domain, type, role }
}
