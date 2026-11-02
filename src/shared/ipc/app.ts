/** App shell: product name, version and build, and the testing tools in the build menu. */

import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

/** Which build is running, so a tester can say exactly what they tested. */
export interface AppBuild {
  /** Short git commit the build was made from, or null when it was built outside git. */
  commit: string | null
  /**
   * The build number that only goes up (the git commit count at build time),
   * or null for a run that was not bundled. Shown on the footer release line.
   */
  number?: number | null
  /** When the build was made, ISO 8601. */
  builtAt: string
}

export interface AppInfo {
  name: string
  version: string
  /** Absent in tests and tools that build an AppInfo by hand. */
  build?: AppBuild
  /** True when this window runs the separate test profile ("Test as a new user"). */
  testProfile?: boolean
}

/**
 * "Reset CiteFox, keep my keys": the app moves every project, setting and
 * history aside (one backup is kept), keeps the API keys and their keychain
 * items, turns off the background job and login item, and restarts on the
 * first run. `ok: false` changes nothing and says why.
 */
export type AppResetResult = { ok: true } | { ok: false; message: string }

export interface OpenTestProfileRequest {
  /** True clears the test profile (its data and its own keychain items) before opening it. */
  fresh: boolean
}

/** "Test as a new user": a second CiteFox window on its own data folder and keychain items. */
export type OpenTestProfileResult =
  { ok: true; alreadyOpen: boolean } | { ok: false; message: string }

/** Invoke channels for this area. Each one is declared here only. */
export const appChannels = {
  'app:getInfo': invoke<AppInfo>(),
  'app:resetKeepKeys': invoke<AppResetResult>(),
  'app:openTestProfile': invokeWith<OpenTestProfileRequest, OpenTestProfileResult>()
} as const satisfies InvokeChannelSpecs
