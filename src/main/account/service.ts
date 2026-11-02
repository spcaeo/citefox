import { checkAccountDetails } from '@shared/account'
import type { AccountSaveResult, AccountStatus, AppInfo } from '@shared/ipc'
import type { Logger } from '../logging/logger'
import type { HttpTransport } from '../providers/http'
import type { RegisterEndpoint } from './endpoint'
import { postToScript } from './post'
import type { AccountState, AccountStore } from './store'

/** A queued registration is retried at most this often. */
export const RETRY_GAP_MS = 60 * 60 * 1000
/** A failed ping is retried at most this often (one ping goes through per day). */
export const PING_RETRY_GAP_MS = 60 * 60 * 1000

export interface AccountServiceDeps {
  store: AccountStore
  /** Null: no registration address in this build, so nothing is ever sent. */
  endpoint: RegisterEndpoint | null
  http: HttpTransport
  appInfo: () => AppInfo
  logger: Logger
  now?: () => Date
  platform?: string
  arch?: string
}

export interface AccountService {
  status(): AccountStatus
  /** Saves the details here first, then tries to send them. Offline still counts as joined. */
  save(input: unknown): Promise<AccountSaveResult>
  /** Retries a queued registration and sends today's ping, each when due. Never throws. */
  tick(): Promise<void>
}

/** "2026-11-02" in the computer's own zone. */
export function localDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function createAccountService(deps: AccountServiceDeps): AccountService {
  const now = deps.now ?? ((): Date => new Date())
  const platform = deps.platform ?? process.platform
  const arch = deps.arch ?? process.arch
  let running: Promise<void> | null = null

  function toStatus(state: AccountState): AccountStatus {
    return {
      enabled: deps.endpoint !== null,
      joined: state.details !== null,
      waiting: deps.endpoint !== null && state.waiting,
      details: state.details
    }
  }

  function facts(): Record<string, unknown> {
    const info = deps.appInfo()
    return {
      version: info.version,
      build: info.build?.number ?? null,
      os: platform,
      arch
    }
  }

  async function send(state: AccountState): Promise<boolean> {
    if (deps.endpoint === null || state.details === null) return false
    deps.store.update({ lastTryAt: now().toISOString() })
    try {
      const reply = await postToScript(deps.http, deps.endpoint, {
        kind: 'register',
        installId: state.installId,
        name: state.details.name,
        email: state.details.email,
        company: state.details.company,
        role: state.details.role,
        productUpdates: state.details.productUpdates,
        news: state.details.news,
        ...facts()
      })
      if (reply.ok) {
        deps.store.update({ waiting: false })
        return true
      }
      deps.logger.warn('CiteFox account: the registration was not accepted yet', {
        reason: reply.error
      })
    } catch {
      deps.logger.info('CiteFox account: offline, the registration will be sent later')
    }
    return false
  }

  async function ping(state: AccountState): Promise<void> {
    if (deps.endpoint === null) return
    const day = localDay(now())
    if (state.lastPingDay === day) return
    const tried = state.lastPingTryAt ? Date.parse(state.lastPingTryAt) : 0
    if (now().getTime() - tried < PING_RETRY_GAP_MS) return
    deps.store.update({ lastPingTryAt: now().toISOString() })
    try {
      const reply = await postToScript(deps.http, deps.endpoint, {
        kind: 'ping',
        installId: state.installId,
        day,
        ...facts()
      })
      if (reply.ok) deps.store.update({ lastPingDay: day })
    } catch {
      // Offline: try again later today.
    }
  }

  async function runTick(): Promise<void> {
    if (deps.endpoint === null) return
    const state = deps.store.read()
    if (state.waiting && state.details !== null) {
      const tried = state.lastTryAt ? Date.parse(state.lastTryAt) : 0
      if (now().getTime() - tried >= RETRY_GAP_MS) await send(state)
    }
    await ping(deps.store.read())
  }

  return {
    status: () => toStatus(deps.store.read()),
    async save(input) {
      const checked = checkAccountDetails(input)
      if (!checked.ok) return { ok: false, errors: checked.errors }
      const before = deps.store.read()
      const state = deps.store.update({
        details: checked.details,
        joinedAt: before.joinedAt ?? now().toISOString(),
        waiting: deps.endpoint !== null
      })
      await send(state)
      return { ok: true, status: toStatus(deps.store.read()) }
    },
    tick() {
      if (running === null) {
        running = runTick()
          .catch(() => undefined)
          .finally(() => {
            running = null
          })
      }
      return running
    }
  }
}
