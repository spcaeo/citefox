import type { AppInfo } from '@shared/ipc'
import type { AccountServices } from '../handlers/account'
import { RELEASE_REPO } from '../handlers/account'
import type { Logger } from '../logging/logger'
import type { HttpTransport } from '../providers/http'
import { createUpdateService } from '../updates/service'
import { registerEndpoint, type RegisterEndpoint } from './endpoint'
import { createAccountService } from './service'
import { accountFilePath, createAccountStore } from './store'

/** How often a running app looks for a due ping or a queued registration. */
export const TICK_MS = 60 * 60 * 1000

/**
 * Production wiring (main/index.ts): the account and update services on the
 * data folder's account.json, and an hourly tick that sends at most one ping a
 * day and retries a registration made offline. With no registration address
 * in the build the tick does nothing; the update check runs on its own only in
 * a packaged app.
 */
export function startAccountRuntime(input: {
  dataRoot: string
  http: HttpTransport
  appInfo: () => AppInfo
  logger: Logger
  packaged: boolean
  endpoint?: RegisterEndpoint | null
}): { services: AccountServices; stop: () => void } {
  const store = createAccountStore(accountFilePath(input.dataRoot))
  // Only an installed app joins and pings; dev runs and tests never call out unless
  // CITEFOX_REGISTER_DEV=1 (to try the Join step against the real Sheet).
  const live = input.packaged || process.env.CITEFOX_REGISTER_DEV === '1'
  const endpoint =
    input.endpoint === undefined ? (live ? registerEndpoint() : null) : input.endpoint
  const account = createAccountService({
    store,
    endpoint,
    http: input.http,
    appInfo: input.appInfo,
    logger: input.logger
  })
  const updates = createUpdateService({
    store,
    http: input.http,
    appInfo: input.appInfo,
    logger: input.logger,
    repo: RELEASE_REPO,
    autoCheck: input.packaged
  })
  let timer: ReturnType<typeof setInterval> | null = null
  if (endpoint !== null) {
    void account.tick()
    timer = setInterval(() => void account.tick(), TICK_MS)
    timer.unref?.()
  }
  return {
    services: { account, updates, reports: { endpoint, installId: () => store.read().installId } },
    stop: () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
  }
}
