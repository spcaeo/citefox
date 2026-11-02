import type {
  AccountDetails,
  AccountSaveResult,
  AccountStatus,
  DismissUpdateRequest,
  UpdateStatus
} from '@shared/ipc'

/** "Join CiteFox" and the account card. */
export interface AccountClient {
  get(): Promise<AccountStatus>
  save(details: AccountDetails): Promise<AccountSaveResult>
}

/** The new-version banner, the footer dot and "Check for updates". */
export interface UpdatesClient {
  get(): Promise<UpdateStatus>
  check(): Promise<UpdateStatus>
  dismiss(request: DismissUpdateRequest): Promise<UpdateStatus>
}

/** What a window without registration sees (no bridge, the mock, an old preload). */
export const ACCOUNT_OFF: AccountStatus = {
  enabled: false,
  joined: false,
  waiting: false,
  details: null
}

export const NO_UPDATE: UpdateStatus = {
  available: false,
  latest: null,
  dismissed: false,
  checkedAt: null,
  failed: false
}

/** The preload API, or null when this window has none (tests, the mock). */
export function ipcAccountClient(): AccountClient | null {
  const api = typeof window === 'undefined' ? undefined : window.citefox
  if (!api || typeof api['account:get'] !== 'function') return null
  return {
    get: () => api['account:get'](),
    save: (details) => api['account:save'](details)
  }
}

export function ipcUpdatesClient(): UpdatesClient | null {
  const api = typeof window === 'undefined' ? undefined : window.citefox
  if (!api || typeof api['updates:get'] !== 'function') return null
  return {
    get: () => api['updates:get'](),
    check: () => api['updates:check'](),
    dismiss: (request) => api['updates:dismiss'](request)
  }
}
