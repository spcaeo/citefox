/**
 * Moving to a new Mac: one project as a `.citefox-project.json` file (export and
 * import), and the app settings as a `.citefox-settings.json` file. Main opens
 * the native save and open dialogs, so no path ever crosses IPC: a picked file
 * stands for an opaque token. API keys, SMTP passwords and Slack webhooks stay
 * in the keychain and are never written to either file.
 */

import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/** Largest file the import accepts. */
export const TRANSFER_MAX_FILE_BYTES = 200 * 1024 * 1024

/** The parts of a project file, in the order the preview lists them. */
export const PROJECT_TRANSFER_SECTIONS = [
  'settings',
  'markets',
  'pages',
  'topics',
  'questions',
  'buyerProfile',
  'competitors',
  'products',
  'groups',
  'alertRules',
  'reportSchedules',
  'notes',
  'results'
] as const

export type ProjectTransferSection = (typeof PROJECT_TRANSFER_SECTIONS)[number]

export function isProjectTransferSection(value: unknown): value is ProjectTransferSection {
  return (
    typeof value === 'string' && (PROJECT_TRANSFER_SECTIONS as readonly string[]).includes(value)
  )
}

/** One part of the file and how many things it holds. */
export interface ProjectTransferSectionCount {
  section: ProjectTransferSection
  label: string
  count: number
}

/** `transfer:projectSummary`: what an export of this project would hold. */
export interface ProjectTransferSummary {
  projectId: string
  name: string
  domain: string
  sections: readonly ProjectTransferSectionCount[]
  /** Stored checks (runs). Written only when the export includes check results. */
  checkCount: number
}

export interface ExportProjectRequest {
  projectId: string
  /** Off by default: stored check results make the file much larger. */
  includeResults: boolean
}

/** A save or open that did not happen. `cancelled` is true when the dialog was closed. */
export interface TransferFailure {
  ok: false
  cancelled: boolean
  reason: string
  nextStep: string
}

export type ExportProjectResult =
  | { ok: true; filename: string; bytes: number; sections: readonly ProjectTransferSectionCount[] }
  | TransferFailure

/** `transfer:pickProject` / `transfer:pickSettings`: the picked file stands for a token. */
export type TransferPickResult = { ok: true; token: string; filename: string } | TransferFailure

export interface TransferTokenRequest {
  token: string
}

/** A project already in CiteFox for the same site, offered as "Replace …". */
export interface SameSiteProject {
  projectId: string
  name: string
}

export type ProjectImportMode = 'new' | 'replace'

/** Per part of the file: what the import did. */
export interface ProjectImportSectionResult {
  section: ProjectTransferSection
  label: string
  added: number
  skipped: number
  failed: number
  /** Plain reasons for skipped and failed rows, at most a few per part. */
  notes: readonly string[]
}

export interface ProjectImportResult {
  mode: ProjectImportMode
  projectId: string
  projectName: string
  sections: readonly ProjectImportSectionResult[]
  /** Import as new only: Undo deletes the project the import created. */
  undoable: boolean
}

/** `transfer:projectPreview`: what the picked file holds, and the result once imported. */
export interface ProjectImportPreview {
  token: string
  filename: string
  /** The file's format version and the project database version it was written from. */
  formatVersion: number
  schemaVersion: number
  appVersion: string
  exportedAt: string
  project: { name: string; domain: string; clientName: string | null }
  includesResults: boolean
  sections: readonly ProjectTransferSectionCount[]
  sameSite: readonly SameSiteProject[]
  /** Set once this file was imported (and the project still exists). */
  result: ProjectImportResult | null
}

export interface ImportProjectRequest {
  token: string
  mode: ProjectImportMode
  /** Required for `replace`: a project with the same site. */
  replaceProjectId: string | null
}

/** One app setting in a settings file. Values are display text. */
export interface SettingsTransferField {
  key: string
  label: string
  current: string
  incoming: string
  changed: boolean
}

export type SettingsFieldOutcome = 'applied' | 'unchanged' | 'failed'

export interface SettingsTransferFieldResult {
  key: string
  label: string
  outcome: SettingsFieldOutcome
  reason: string | null
}

export type ExportSettingsResult =
  { ok: true; filename: string; bytes: number; fieldCount: number } | TransferFailure

/** `transfer:settingsPreview`. */
export interface SettingsImportPreview {
  token: string
  filename: string
  formatVersion: number
  appVersion: string
  exportedAt: string
  fields: readonly SettingsTransferField[]
  /** Set once applied. */
  result: readonly SettingsTransferFieldResult[] | null
}

/** File menu items the renderer carries out (`transfer:menu`). */
export const TRANSFER_MENU_COMMANDS = [
  'export-project',
  'import-project',
  'export-settings',
  'import-settings'
] as const

export type TransferMenuCommand = (typeof TRANSFER_MENU_COMMANDS)[number]

export interface TransferMenuEvent {
  command: TransferMenuCommand
}

/** Invoke channels for this area. Each one is declared here only. */
export const transferChannels = {
  'transfer:projectSummary': invokeWith<{ projectId: string }, ProjectTransferSummary>(),
  'transfer:exportProject': invokeWith<ExportProjectRequest, ExportProjectResult>(),
  'transfer:pickProject': invoke<TransferPickResult>(),
  'transfer:projectPreview': invokeWith<TransferTokenRequest, ProjectImportPreview>(),
  'transfer:importProject': invokeWith<ImportProjectRequest, ProjectImportResult>(),
  'transfer:exportSettings': invoke<ExportSettingsResult>(),
  'transfer:pickSettings': invoke<TransferPickResult>(),
  'transfer:settingsPreview': invokeWith<TransferTokenRequest, SettingsImportPreview>(),
  'transfer:applySettings': invokeWith<
    TransferTokenRequest,
    readonly SettingsTransferFieldResult[]
  >()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const transferEvents = {
  'transfer:menu': push<TransferMenuEvent>()
} as const satisfies PushChannelSpecs
