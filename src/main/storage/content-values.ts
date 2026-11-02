import { StorageError } from './errors'

/** Count and duration checks shared by the project content record modules. */

export function requireCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new StorageError(`Invalid ${label}`)
  return value
}

export function requireDuration(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new StorageError('Invalid duration')
  return value
}
