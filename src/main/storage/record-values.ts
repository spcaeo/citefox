import { containsSecret } from '../logging/redact'
import { isSqliteError } from './database'
import { StorageError } from './errors'

/** Validators and the write wrapper shared by the app.sqlite record modules. */

export const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

export function runWrite(write: () => unknown, action: string): void {
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) {
      if (
        error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
      ) {
        throw new StorageError(`${action}: already exists`)
      }
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        throw new StorageError(`${action}: referenced row is missing`)
      }
      if (error.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new StorageError(`${action}: rejected by the database`)
      }
    }
    throw new StorageError(`${action} failed`)
  }
}

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
  rejectSecret(value, label, true)
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

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new StorageError(`Invalid ${label}`)
  return value
}

export function requireInteger(value: number, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new StorageError(`Invalid ${label}`)
  }
  return value
}

export function requireUtcTimestamp(value: string): string {
  if (!UTC_TIMESTAMP.test(value)) throw new StorageError('Invalid timestamp')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new StorageError('Invalid timestamp')
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z')
  if (parsed.toISOString() !== canonical) throw new StorageError('Invalid timestamp')
  return value
}

export function rejectSecret(value: string, label: string, hexKeys: boolean): void {
  if (containsSecret(value, { hexKeys })) throw new StorageError(`${label} cannot contain a secret`)
}

export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
