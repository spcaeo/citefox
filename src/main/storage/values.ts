import { containsSecret } from '../logging/redact'
import { StorageError } from './errors'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const HASH_64 = /^[a-f0-9]{64}$/

export function assertId(value: string): string {
  if (!ID.test(value)) throw new StorageError('Invalid id')
  return value
}

export function requireLabel(value: string, label: string, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.trim() !== value
  ) {
    throw new StorageError(`Invalid ${label}`)
  }
  if (hasControlCharacter(value)) throw new StorageError(`Invalid ${label}`)
  rejectSecret(value, label)
  return value
}

export function requireOptionalLabel(
  value: string | null,
  label: string,
  max: number
): string | null {
  if (value === null) return null
  return requireLabel(value, label, max)
}

export function requireUtcTimestamp(value: string): string {
  if (!UTC_TIMESTAMP.test(value)) throw new StorageError('Invalid timestamp')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new StorageError('Invalid timestamp')
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z')
  if (parsed.toISOString() !== canonical) throw new StorageError('Invalid timestamp')
  return value
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const LOCAL_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** SCH-1 and SCH-9. Local `HH:MM`, 24-hour. Quiet hours and the daily check use this. */
export const DEFAULT_DAILY_CHECK_TIME = '08:00'

export function requireClockTime(value: string, label: string): string {
  if (typeof value !== 'string' || !CLOCK_TIME.test(value))
    throw new StorageError(`Invalid ${label}`)
  return value
}

/** Local calendar date `YYYY-MM-DD` (SCH-2). Not an instant. */
export function requireLocalDate(value: string): string {
  if (typeof value !== 'string') throw new StorageError('Invalid local date')
  const match = LOCAL_DATE.exec(value)
  if (match === null) throw new StorageError('Invalid local date')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new StorageError('Invalid local date')
  }
  return value
}

export function requireContentHash(value: string): string {
  if (!HASH_64.test(value)) throw new StorageError('Invalid content hash')
  return value
}

/**
 * Page and prompt text. API-key shapes are rejected. A 64-character hex string
 * is allowed here: a page can quote a fingerprint, and the content hash has
 * its own column. Labels use {@link requireLabel}, which still redacts hex keys.
 */
export function requireStoredText(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new StorageError(`Invalid ${label}`)
  }
  if (value.includes('\0')) throw new StorageError(`Invalid ${label}`)
  if (containsSecret(value, { hexKeys: false })) {
    throw new StorageError(`${label} cannot contain a secret`)
  }
  return value
}

/** JSON stored from a page or a model. A content hash inside the text is not a key. */
export function requireJsonDocument(value: unknown, label: string): string {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new StorageError(`Invalid ${label}`)
  }
  if (encoded === undefined || encoded.length === 0 || encoded.length > 500_000) {
    throw new StorageError(`Invalid ${label}`)
  }
  if (containsSecret(encoded, { hexKeys: false })) {
    throw new StorageError(`${label} cannot contain a secret`)
  }
  return encoded
}

export function requireJsonValue(value: unknown, label: string): string {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new StorageError(`Invalid ${label}`)
  }
  if (encoded === undefined || encoded.length === 0 || encoded.length > 500_000) {
    throw new StorageError(`Invalid ${label}`)
  }
  rejectSecret(encoded, label)
  return encoded
}

export function readJson(encoded: string, label: string): unknown {
  try {
    return JSON.parse(encoded) as unknown
  } catch {
    throw new StorageError(`Invalid ${label}`)
  }
}

function rejectSecret(value: string, label: string): void {
  if (containsSecret(value, { hexKeys: true })) {
    throw new StorageError(`${label} cannot contain a secret`)
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
