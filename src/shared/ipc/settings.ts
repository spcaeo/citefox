/** App settings. */

import type {
  AppSettings,
  ClaudeProvider,
  IntervalDays,
  JinaMode,
  MarketDevice,
  SampleCount,
  SerpApiRotationMode,
  SidebarMode,
  ThemePreference
} from '../domain'
import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/** Editable fields of {@link AppSettings}. Omitted fields stay as they are. */
export type AppSettingsPatch = Partial<{
  userName: string | null
  defaultCountry: string | null
  defaultLanguage: string | null
  defaultLocation: string | null
  defaultDevice: MarketDevice
  defaultIntervalDays: IntervalDays
  defaultSamples: SampleCount
  defaultPromptCount: number
  claudeBinaryPath: string | null
  claudeConcurrency: number
  claudeModel: string | null
  claudeProvider: ClaudeProvider
  codexBinaryPath: string | null
  codexModel: string | null
  codexQuickModel: string | null
  jinaMode: JinaMode
  /** FR-11.2. `in_order`, `spread_evenly`, or `project_keys`. */
  serpapiRotation: SerpApiRotationMode
  /** The sidebar collapse choice (v2 shell). */
  sidebar: SidebarMode
  /** Settings › Appearance: `system`, `light` or `dark`. Applies at once. */
  theme: ThemePreference
  /** Settings › Appearance › "Celebrate citations". Applies at once. */
  celebrate: boolean
  /** Settings › Appearance › "Play a sound" with the celebration. Applies at once. */
  celebrateSound: boolean
}>

/**
 * `settings:themeChanged`: the theme choice changed, from Settings › Appearance
 * or the View › Appearance menu, so every window follows it.
 */
export interface ThemeChangedEvent {
  theme: ThemePreference
}

/** `settings:get` and `settings:update`. `dataDirectory` is not editable. */
export interface AppSettingsSnapshot {
  settings: AppSettings
  /**
   * Absolute path of the app data folder (section 9.2).
   * Project databases live under it. Secrets do not.
   */
  dataDirectory: string
}

/** One project in an "Export all data" zip. `error` says why its file is missing. */
export interface AllDataProjectEntry {
  id: string
  name: string
  slug: string
  /** Path inside the zip, such as `projects/example.citefox.json`. Null when it failed. */
  file: string | null
  error: string | null
}

/**
 * `settings:exportAllData`. Main asks where to save with a save dialog (the
 * renderer never sends a path) and writes one zip: every project's JSON export
 * v2, the app settings and a manifest. Secrets stay in the system keychain and
 * are never in the zip. `cancelled` is true when the person closed the dialog.
 */
export type ExportAllDataResult =
  | {
      ok: true
      filePath: string
      filename: string
      bytes: number
      projects: AllDataProjectEntry[]
    }
  | { ok: false; cancelled: boolean; reason: string; nextStep: string }

/** `settings:openDataFolder`. Shows the app data folder in Finder, Explorer or the file manager. */
export type OpenDataFolderResult = { ok: true } | { ok: false; reason: string; nextStep: string }

/**
 * `settings:revealPath`. Shows one file or folder in Finder, Explorer or the file
 * manager: only a path inside the app data folder (a project database, a backup),
 * so the renderer can never point the file manager at anything else.
 */
export interface RevealPathRequest {
  path: string
}

export type RevealPathResult = OpenDataFolderResult

/** Invoke channels for this area. Each one is declared here only. */
export const settingsChannels = {
  'settings:get': invoke<AppSettingsSnapshot>(),
  'settings:update': invokeWith<AppSettingsPatch, AppSettingsSnapshot>(),
  'settings:exportAllData': invoke<ExportAllDataResult>(),
  'settings:openDataFolder': invoke<OpenDataFolderResult>(),
  'settings:revealPath': invokeWith<RevealPathRequest, RevealPathResult>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const settingsEvents = {
  'settings:themeChanged': push<ThemeChangedEvent>()
} as const satisfies PushChannelSpecs
