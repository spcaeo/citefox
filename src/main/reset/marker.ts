import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/domain'
import { atomicWriteFile } from '../storage/atomic-file'
import type { ApiKeyRecord } from '../storage/records'

/**
 * "Reset CiteFox, keep my keys" happens in two halves. The running app writes
 * this marker and restarts; the next start finds it and resets before storage
 * opens. The file lives in the data folder, so a test profile resets only itself.
 */
export const RESET_MARKER_FILE = 'reset-pending.json'

/** What the reset carries into the fresh data. Key records hold keychain refs, never secrets. */
export interface ResetKept {
  keys: ApiKeyRecord[]
  /** The settings that say how the kept keys are used. */
  settings: Partial<AppSettings>
}

export interface ResetMarker {
  version: 1
  requestedAt: string
  /**
   * Filled in by the first start that begins the reset, before any file moves,
   * so a start that crashes part-way still has the keys on the next try.
   */
  kept: ResetKept | null
  /** Backup folder name under `backups/` the files are being moved to. */
  backup: string | null
}

export function resetMarkerPath(userData: string): string {
  return join(userData, RESET_MARKER_FILE)
}

export function resetPending(userData: string): boolean {
  return existsSync(resetMarkerPath(userData))
}

export function writeResetMarker(userData: string, marker: ResetMarker): void {
  atomicWriteFile(resetMarkerPath(userData), `${JSON.stringify(marker, null, 2)}\n`)
}

/** Null when there is no marker. A marker that cannot be read is a fresh request. */
export function readResetMarker(userData: string): ResetMarker | null {
  const file = resetMarkerPath(userData)
  if (!existsSync(file)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    parsed = null
  }
  return parseMarker(parsed)
}

export function removeResetMarker(userData: string): void {
  rmSync(resetMarkerPath(userData), { force: true })
}

function parseMarker(value: unknown): ResetMarker {
  const fallback: ResetMarker = {
    version: 1,
    requestedAt: new Date(0).toISOString(),
    kept: null,
    backup: null
  }
  if (typeof value !== 'object' || value === null) return fallback
  const record = value as Record<string, unknown>
  const kept = record.kept
  const keptValid =
    typeof kept === 'object' &&
    kept !== null &&
    Array.isArray((kept as Record<string, unknown>).keys) &&
    typeof (kept as Record<string, unknown>).settings === 'object' &&
    (kept as Record<string, unknown>).settings !== null
  return {
    version: 1,
    requestedAt: typeof record.requestedAt === 'string' ? record.requestedAt : fallback.requestedAt,
    kept: keptValid ? (kept as ResetKept) : null,
    backup:
      typeof record.backup === 'string' && /^reset-[0-9TZ-]+$/.test(record.backup)
        ? record.backup
        : null
  }
}
