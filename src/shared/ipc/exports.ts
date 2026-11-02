/** Exports and auto-export. */

import type {
  AutoExport,
  ExportDestination,
  ExportPhase,
  ExportPreview,
  ExportSpec,
  ExportStartResult,
  WorkProgressState
} from '../domain'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'

/**
 * `exports:preview` and `exports:start` (FR-22).
 * `logoBase64` is write-only PNG, SVG, or JPG. It is not stored and not returned.
 * `raw` in `sections` is legal only when `format` is `json` (FR-22.3).
 */
export interface ExportRequest extends ExportSpec {
  logoBase64: string | null
}

/**
 * Why `exports:getAuto`, `exports:setAuto` or `exports:chooseAutoFolder` resolved
 * without an `AutoExport`. The message is a fixed sentence. It does not include
 * the channel or the request.
 * - `unavailable`: this build cannot store automatic exports (the card stays hidden).
 * - `no_folder`: turning it on needs a folder chosen in the dialog first.
 * - `folder`: the chosen folder is gone or CiteFox cannot write to it.
 * - `email`: automatic exports go to a folder; email is a scheduled report.
 * - `invalid`: the settings cannot be repeated (nothing picked, or a bad option).
 */
export const AUTO_EXPORT_ERROR_CODES = [
  'unavailable',
  'no_folder',
  'folder',
  'email',
  'invalid'
] as const

export type AutoExportErrorCode = (typeof AUTO_EXPORT_ERROR_CODES)[number]

/** Fixed sentences for {@link AutoExportErrorCode}. The engine does not paraphrase these. */
export const AUTO_EXPORT_ERROR_MESSAGES = {
  unavailable: "Automatic exports aren't available yet.",
  no_folder: 'Choose a folder for automatic exports first.',
  folder: "CiteFox can't write to that folder.",
  email: 'Automatic exports are saved to a folder.',
  invalid: "These export settings can't be repeated automatically."
} as const satisfies Record<AutoExportErrorCode, string>

/** What to do next for each {@link AutoExportErrorCode}. */
export const AUTO_EXPORT_NEXT_STEPS = {
  unavailable: 'Export from Reports when you need a file.',
  no_folder: 'Choose a folder, then turn automatic export on.',
  folder: 'Choose another folder.',
  email: 'To email a report, add a scheduled report in Reports.',
  invalid: 'Pick at least one section and a format, then try again.'
} as const satisfies Record<AutoExportErrorCode, string>

/** Guidance returned with the `unavailable` code. */
export const AUTO_EXPORT_UNAVAILABLE_NEXT_STEP = AUTO_EXPORT_NEXT_STEPS.unavailable

export const AUTO_EXPORT_ERROR_CHANNELS = [
  'exports:getAuto',
  'exports:setAuto',
  'exports:chooseAutoFolder'
] as const

export type AutoExportErrorChannel = (typeof AUTO_EXPORT_ERROR_CHANNELS)[number]

export function isAutoExportErrorChannel(value: string): value is AutoExportErrorChannel {
  return AUTO_EXPORT_ERROR_CHANNELS.some((item) => item === value)
}

/**
 * Structured result when an auto-export call has no `AutoExport` to return.
 * `message` is the fixed sentence for `code` and has no channel prefix.
 * `nextStep` is the matching {@link AUTO_EXPORT_NEXT_STEPS} sentence.
 */
export type AutoExportUnavailable = {
  [Code in AutoExportErrorCode]: {
    code: Code
    message: (typeof AUTO_EXPORT_ERROR_MESSAGES)[Code]
    nextStep: string
  }
}[AutoExportErrorCode]

/** The fixed result for `code`. */
export function autoExportProblem(code: AutoExportErrorCode): AutoExportUnavailable {
  return {
    code,
    message: AUTO_EXPORT_ERROR_MESSAGES[code],
    nextStep: AUTO_EXPORT_NEXT_STEPS[code]
  } as AutoExportUnavailable
}

export function isAutoExportErrorCode(value: string): value is AutoExportErrorCode {
  return AUTO_EXPORT_ERROR_CODES.some((item) => item === value)
}

/** `exports:getAuto`. */
export interface AutoExportScopeRequest {
  projectId: string
  pageId: string | null
}

/**
 * `exports:setAuto`. `spec` is what later scheduled checks repeat (FR-22.6).
 * `folder` must be null or the folder already stored for this scope: only
 * `exports:chooseAutoFolder` (the native dialog in main) sets a folder.
 */
export interface SetAutoExportRequest {
  projectId: string
  pageId: string | null
  enabled: boolean
  destination: ExportDestination
  folder: string | null
  emailTo: string | null
  spec: ExportSpec
}

/** Pushed during `exports:start` when a file is actually being written (NFR-17). */
export interface ExportProgress {
  exportId: string
  phase: ExportPhase
  state: WorkProgressState
  done: number
  total: number
  detail: string
  /** NFR-10. Null unless `state` is `warning`. */
  nextStep: string | null
}

/**
 * `exports:reveal`. Shows a file in Finder (Explorer, the file manager). Only a
 * file an `exports:start` in this run of CiteFox wrote, and only while it is
 * still there. The renderer cannot reveal any other path.
 */
export interface RevealExportRequest {
  filePath: string
}

/** `ok: false` says why, as a sentence, with what to do next. */
export type RevealExportResult = { ok: true } | { ok: false; reason: string; nextStep: string }

/** Invoke channels for this area. Each one is declared here only. */
export const exportsChannels = {
  'exports:preview': invokeWith<ExportRequest, ExportPreview>(),
  'exports:start': invokeWith<ExportRequest, ExportStartResult>(),
  'exports:getAuto': invokeWith<AutoExportScopeRequest, AutoExport | AutoExportUnavailable>(),
  'exports:setAuto': invokeWith<SetAutoExportRequest, AutoExport | AutoExportUnavailable>(),
  'exports:chooseAutoFolder': invokeWith<
    AutoExportScopeRequest,
    AutoExport | AutoExportUnavailable
  >(),
  'exports:reveal': invokeWith<RevealExportRequest, RevealExportResult>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const exportsEvents = {
  'exports:progress': push<ExportProgress>()
} as const satisfies PushChannelSpecs
