/** "Join CiteFox" and the new-version check (Docs/PRIVACY.md, Docs/IPC.md). */

import type { accountChannels, IpcHandlersFor } from '@shared/ipc'
import { githubSlug } from '@shared/release-compare'
import packageJson from '../../../package.json'
import { createAccountService, type AccountService } from '../account/service'
import { accountFilePath, createAccountStore } from '../account/store'
import { createUpdateService, type UpdateService } from '../updates/service'
import { guard, type EngineContext } from './context'

export interface AccountServices {
  account: AccountService
  updates: UpdateService
}

/** "owner/repo" of the GitHub project releases come from (package.json `repository`). */
export const RELEASE_REPO = githubSlug(packageJson.repository)

/**
 * The services a run without production wiring gets (tests, tools): the
 * account file in the data folder, no registration address (nothing is
 * sent) and no automatic update check.
 */
export function defaultAccountServices(ctx: EngineContext): AccountServices {
  const store = createAccountStore(accountFilePath(ctx.storage.paths.root))
  return {
    account: createAccountService({
      store,
      endpoint: null,
      http: ctx.http,
      appInfo: ctx.appInfo,
      logger: ctx.logger,
      now: ctx.now
    }),
    updates: createUpdateService({
      store,
      http: ctx.http,
      appInfo: ctx.appInfo,
      logger: ctx.logger,
      repo: RELEASE_REPO,
      autoCheck: false,
      now: ctx.now
    })
  }
}

export function accountHandlers(
  ctx: EngineContext,
  services: AccountServices
): IpcHandlersFor<typeof accountChannels> {
  const { account, updates } = services
  return {
    'account:get': () =>
      guard('account:get', ctx, () => {
        // A window opening is a good moment to retry a queued registration and ping.
        void account.tick()
        return account.status()
      }),
    'account:save': (details) => guard('account:save', ctx, () => account.save(details)),
    'updates:get': () => guard('updates:get', ctx, () => updates.get()),
    'updates:check': () => guard('updates:check', ctx, () => updates.check()),
    'updates:dismiss': (request) => guard('updates:dismiss', ctx, () => updates.dismiss(request))
  }
}
