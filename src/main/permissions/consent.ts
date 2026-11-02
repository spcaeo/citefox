import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFile } from '../storage/atomic-file'

/**
 * What the user has agreed to in "What CiteFox needs", kept in
 * `<data folder>/permissions.json`. CiteFox shows a system prompt (the macOS
 * notification request, "Login Item Added") only after one of these is set by a
 * click. No secret is ever written here.
 */
export interface PermissionConsent {
  /** The user turned on Open at login here (or had it before this file existed). */
  loginItem: boolean
  /** The user turned on notifications here (on macOS this showed the system prompt). */
  notifications: boolean
  /** How the last test notification went. */
  notificationResult: 'shown' | 'failed' | null
  /** ISO-8601 UTC of the last "Check access now". */
  keychainCheckedAt: string | null
  /** Secrets that check could not read. */
  keychainFailed: number
}

export interface PermissionConsentStore {
  read(): PermissionConsent
  update(patch: Partial<PermissionConsent>): PermissionConsent
}

export const PERMISSIONS_FILE = 'permissions.json'

export function permissionsFilePath(root: string): string {
  return join(root, PERMISSIONS_FILE)
}

/**
 * A missing file starts from defaults. An install that finished onboarding
 * before this file existed keeps what it already had: notifications and the
 * login item stay on, so an update does not silently turn them off.
 */
export function defaultConsent(existingInstall: boolean): PermissionConsent {
  return {
    loginItem: existingInstall,
    notifications: existingInstall,
    notificationResult: null,
    keychainCheckedAt: null,
    keychainFailed: 0
  }
}

export function createPermissionConsentStore(input: {
  filePath: string
  /** Read when the file is missing. True for an install that finished onboarding. */
  existingInstall: () => boolean
}): PermissionConsentStore {
  let cached: PermissionConsent | null = null
  function load(): PermissionConsent {
    if (cached !== null) return cached
    cached = parseConsent(readText(input.filePath)) ?? defaultConsent(safe(input.existingInstall))
    return cached
  }
  return {
    read: () => ({ ...load() }),
    update(patch) {
      const next = sanitize({ ...load(), ...patch })
      atomicWriteFile(input.filePath, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`)
      cached = next
      return { ...next }
    }
  }
}

/** In-memory store for tests. */
export function memoryConsentStore(initial?: Partial<PermissionConsent>): PermissionConsentStore {
  let value: PermissionConsent = sanitize({ ...defaultConsent(false), ...initial })
  return {
    read: () => ({ ...value }),
    update(patch) {
      value = sanitize({ ...value, ...patch })
      return { ...value }
    }
  }
}

function safe(read: () => boolean): boolean {
  try {
    return read()
  } catch {
    return false
  }
}

function readText(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  } catch {
    return null
  }
}

/** A corrupt or unknown file reads as missing: the safe default asks again. */
export function parseConsent(text: string | null): PermissionConsent | null {
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 1) return null
  return sanitize({
    loginItem: record.loginItem === true,
    notifications: record.notifications === true,
    notificationResult:
      record.notificationResult === 'shown' || record.notificationResult === 'failed'
        ? record.notificationResult
        : null,
    keychainCheckedAt:
      typeof record.keychainCheckedAt === 'string' ? record.keychainCheckedAt : null,
    keychainFailed: typeof record.keychainFailed === 'number' ? record.keychainFailed : 0
  })
}

function sanitize(value: PermissionConsent): PermissionConsent {
  const at = value.keychainCheckedAt
  return {
    loginItem: value.loginItem === true,
    notifications: value.notifications === true,
    notificationResult: value.notificationResult,
    keychainCheckedAt: at !== null && Number.isFinite(Date.parse(at)) ? at : null,
    keychainFailed:
      Number.isInteger(value.keychainFailed) && value.keychainFailed > 0
        ? Math.min(value.keychainFailed, 10_000)
        : 0
  }
}

/**
 * On macOS the first desktop notification opens a system prompt, so CiteFox
 * raises none until the user turned them on. Other systems ask nothing.
 */
export function notificationsAllowed(platform: string, consent: PermissionConsent): boolean {
  return platform !== 'darwin' || consent.notifications
}
