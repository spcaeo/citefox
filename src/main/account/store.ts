import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAccountDetails, type AccountDetails } from '@shared/account'
import type { UpdateRelease } from '@shared/ipc'
import { atomicWriteFile } from '../storage/atomic-file'

/**
 * `<data folder>/account.json`: the app-wide account and update state, next to
 * settings.json (never inside a project). No secret is ever written here.
 */
export interface AccountState {
  /** Random, made once per install. Not tied to the computer or the person. */
  installId: string
  details: AccountDetails | null
  /** ISO time the person joined (filled in the step), or null. */
  joinedAt: string | null
  /** The details changed and are not sent yet. */
  waiting: boolean
  /** ISO time of the last send attempt, so retries wait between tries. */
  lastTryAt: string | null
  /** Local day (YYYY-MM-DD) of the last ping that went through. */
  lastPingDay: string | null
  /** ISO time of the last ping attempt. */
  lastPingTryAt: string | null
  updates: {
    checkedAt: string | null
    latest: UpdateRelease | null
    failed: boolean
    /** "0.13.0#1500": the release whose banner was closed. */
    dismissed: string | null
  }
}

export interface AccountStore {
  read(): AccountState
  update(patch: Partial<AccountState>): AccountState
}

export const ACCOUNT_FILE = 'account.json'

export function accountFilePath(root: string): string {
  return join(root, ACCOUNT_FILE)
}

export function defaultAccountState(createId: () => string = randomUUID): AccountState {
  return {
    installId: createId(),
    details: null,
    joinedAt: null,
    waiting: false,
    lastTryAt: null,
    lastPingDay: null,
    lastPingTryAt: null,
    updates: { checkedAt: null, latest: null, failed: false, dismissed: null }
  }
}

/** A file store; a missing or broken file starts fresh (and asks to join again). */
export function createAccountStore(filePath: string, createId?: () => string): AccountStore {
  let cached: AccountState | null = null
  function load(): AccountState {
    if (cached !== null) return cached
    const parsed = parseAccountState(readText(filePath))
    if (parsed) {
      cached = parsed
    } else {
      cached = defaultAccountState(createId)
      write(cached)
    }
    return cached
  }
  function write(state: AccountState): void {
    try {
      atomicWriteFile(filePath, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`)
    } catch {
      // A read-only data folder keeps the state for this run only.
    }
  }
  return {
    read: () => structuredClone(load()),
    update(patch) {
      const next = { ...load(), ...patch }
      write(next)
      cached = next
      return structuredClone(next)
    }
  }
}

/** In-memory store for tests. */
export function memoryAccountStore(initial?: Partial<AccountState>): AccountStore {
  let value: AccountState = { ...defaultAccountState(() => 'install-test'), ...initial }
  return {
    read: () => structuredClone(value),
    update(patch) {
      value = { ...value, ...patch }
      return structuredClone(value)
    }
  }
}

function readText(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  } catch {
    return null
  }
}

const ID = /^[A-Za-z0-9-]{8,64}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function release(value: unknown): UpdateRelease | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const https = (v: unknown): v is string => typeof v === 'string' && v.startsWith('https://')
  if (typeof r.version !== 'string' || !https(r.notesUrl) || !https(r.downloadUrl)) return null
  return {
    version: r.version,
    build: typeof r.build === 'number' && Number.isInteger(r.build) ? r.build : null,
    notesUrl: r.notesUrl,
    downloadUrl: r.downloadUrl
  }
}

export function parseAccountState(text: string | null): AccountState | null {
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  if (r.version !== 1 || typeof r.installId !== 'string' || !ID.test(r.installId)) return null
  const checked =
    r.details === null || r.details === undefined ? null : checkAccountDetails(r.details)
  const updates =
    typeof r.updates === 'object' && r.updates !== null
      ? (r.updates as Record<string, unknown>)
      : {}
  return {
    installId: r.installId,
    details: checked?.ok ? checked.details : null,
    joinedAt: checked?.ok ? isoOrNull(r.joinedAt) : null,
    waiting: checked?.ok === true && r.waiting === true,
    lastTryAt: isoOrNull(r.lastTryAt),
    lastPingDay:
      typeof r.lastPingDay === 'string' && DAY.test(r.lastPingDay) ? r.lastPingDay : null,
    lastPingTryAt: isoOrNull(r.lastPingTryAt),
    updates: {
      checkedAt: isoOrNull(updates.checkedAt),
      latest: release(updates.latest),
      failed: updates.failed === true,
      dismissed: typeof updates.dismissed === 'string' ? updates.dismissed.slice(0, 64) : null
    }
  }
}
