/**
 * "Join CiteFox" (registration) and the new-version check. Docs/PRIVACY.md
 * says what is sent; Docs/IPC.md lists the channels.
 */

import type { AccountDetails } from '../account'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

export type { AccountDetails, AccountRole } from '../account'

/** `account:get` and `account:save`. Kept in the app data folder (`account.json`), not per project. */
export interface AccountStatus {
  /**
   * False when this build has no registration address (`CITEFOX_REGISTER_URL`
   * was not set when it was built): no Join step, no account card, nothing sent.
   */
  enabled: boolean
  /** True once the person filled in Join CiteFox, sent or not. */
  joined: boolean
  /** Saved here but not sent yet (offline); CiteFox retries on its own. */
  waiting: boolean
  details: AccountDetails | null
}

export type AccountSaveResult =
  | { ok: true; status: AccountStatus }
  | { ok: false; errors: Partial<Record<'name' | 'email' | 'company' | 'role', string>> }

/** A newer release on GitHub. */
export interface UpdateRelease {
  /** "0.13.0". */
  version: string
  build: number | null
  /** The release page (its notes are "What's new"). */
  notesUrl: string
  /** The installer for this computer, or the release page when none fits. */
  downloadUrl: string
}

/** `updates:get`, `updates:check` and `updates:dismiss`. */
export interface UpdateStatus {
  /** A newer release than this one exists. */
  available: boolean
  /** The newer release, or null when this is the newest (or nothing was read yet). */
  latest: UpdateRelease | null
  /** The person closed the banner for this release; it comes back for the next one. */
  dismissed: boolean
  /** When GitHub was last read, ISO 8601, or null. */
  checkedAt: string | null
  /** The last read failed (offline, GitHub busy). Quiet: only "Check for updates" says so. */
  failed: boolean
}

export interface DismissUpdateRequest {
  version: string
  build: number | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const accountChannels = {
  'account:get': invoke<AccountStatus>(),
  'account:save': invokeWith<AccountDetails, AccountSaveResult>(),
  'updates:get': invoke<UpdateStatus>(),
  'updates:check': invoke<UpdateStatus>(),
  'updates:dismiss': invokeWith<DismissUpdateRequest, UpdateStatus>()
} as const satisfies InvokeChannelSpecs
