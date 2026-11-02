import type { OwnerVerdict, OwnerWhyChange, OwnerWhyPoint, OwnerWhyResult } from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { runWrite } from './record-values'
import { assertId, requireStoredText, requireUtcTimestamp } from './values'

/**
 * Saved page comparisons in the project database (project migration 053): the last
 * "Why Google picks" CiteFox AI wrote for each owner fix of What to fix, shown again
 * when the drawer opens. A new one for the same fix replaces it.
 */

const VERDICTS: readonly OwnerVerdict[] = ['target', 'cited', 'either']
const LIST_MAX = 10
const LINE_MAX = 800
const URL_MAX = 2000

interface WhySql {
  why_json: string
}

/** The saved comparison, checked field by field. Null when anything is off. */
export function toOwnerWhy(value: unknown): OwnerWhyResult | null {
  if (!isRecord(value)) return null
  const { fixId, targetUrl, citedUrl, ownerUrl, verdict, reason, risk, overviews, note, savedAt } =
    value
  if (!isText(fixId, 80) || !isText(targetUrl, URL_MAX) || !isText(citedUrl, URL_MAX)) return null
  if (!isText(ownerUrl, URL_MAX) || !VERDICTS.includes(verdict as OwnerVerdict)) return null
  if (!isText(reason, LINE_MAX) || !isText(note, 200) || !isText(savedAt, 40)) return null
  if (risk !== null && !isText(risk, LINE_MAX)) return null
  if (typeof overviews !== 'number' || !Number.isInteger(overviews) || overviews < 0) return null
  const answerNeeds = readList(value.answerNeeds, (item) => (isText(item, LINE_MAX) ? item : null))
  const citedHas = readList(value.citedHas, toPoint)
  const toChange = readList(value.toChange, toChangeItem)
  if (answerNeeds === null || citedHas === null || toChange === null) return null
  return {
    fixId,
    targetUrl,
    citedUrl,
    verdict: verdict as OwnerVerdict,
    reason,
    answerNeeds,
    citedHas,
    ownerUrl,
    toChange,
    risk: risk as string | null,
    overviews,
    note,
    savedAt
  }
}

function toPoint(value: unknown): OwnerWhyPoint | null {
  if (!isRecord(value)) return null
  const { section, point } = value
  return isText(section, LINE_MAX) && isText(point, LINE_MAX) ? { section, point } : null
}

function toChangeItem(value: unknown): OwnerWhyChange | null {
  if (!isRecord(value)) return null
  const { section, change, why } = value
  return isText(section, LINE_MAX) && isText(change, LINE_MAX) && isText(why, LINE_MAX)
    ? { section, change, why }
    : null
}

/** Every item read, or null when the list is not a list or one item is off. */
function readList<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > LIST_MAX) return null
  const out: T[] = []
  for (const item of value as unknown[]) {
    const one = read(item)
    if (one === null) return null
    out.push(one)
  }
  return out
}

/** The fix's saved comparison, or null. A row that no longer reads as one is null too. */
export function getOwnerWhy(db: SqliteDatabase, fixId: string): OwnerWhyResult | null {
  const row = db
    .prepare<[string], WhySql>('SELECT why_json FROM owner_whys WHERE fix_id = ?')
    .get(assertId(fixId))
  if (row === undefined) return null
  return toOwnerWhy(parseJson(row.why_json))
}

/** Saves the fix's comparison, replacing the one before. */
export function putOwnerWhy(db: SqliteDatabase, why: OwnerWhyResult): OwnerWhyResult {
  const fixId = assertId(why.fixId)
  const checked = toOwnerWhy(why)
  if (checked === null) throw new StorageError('Invalid page comparison')
  const json = requireStoredText(JSON.stringify(checked), 'page comparison', 200_000)
  const savedAt = requireUtcTimestamp(checked.savedAt)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO owner_whys (fix_id, why_json, saved_at) VALUES (?, ?, ?)
           ON CONFLICT (fix_id) DO UPDATE SET
             why_json = excluded.why_json,
             saved_at = excluded.saved_at`
        )
        .run(fixId, json, savedAt),
    'Save page comparison'
  )
  return checked
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
