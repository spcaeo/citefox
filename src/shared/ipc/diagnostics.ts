/**
 * Report a problem. The app builds one plain-text report (version, computer, which AI
 * program and keys are set up, the latest failed checks and the end of the log) and
 * shows it. Nothing is sent by itself: the person copies it, saves it, or opens an
 * email or a GitHub issue after the report is on their clipboard. Keys, emails, the
 * home folder and IP addresses are removed before the text leaves main.
 */

import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/** Longest "What happened?" note, in characters. */
export const DIAGNOSTICS_NOTE_MAX = 2000

/** Longest report text main accepts back for a save or a send, in characters. */
export const DIAGNOSTICS_TEXT_MAX = 400_000

/** Where the email goes. The person sends it; CiteFox never does. */
export const DIAGNOSTICS_EMAIL = 'getcitifox@gmail.com'

/** Where a GitHub issue is opened. */
export const DIAGNOSTICS_ISSUES_URL = 'https://github.com/spcaeo/citefox/issues/new'

export interface BuildDiagnosticsRequest {
  /** Adds the text of the questions behind the failed checks. Off by default. */
  includeQuestions: boolean
  /** The "What happened?" note. Empty is fine. At most {@link DIAGNOSTICS_NOTE_MAX} characters. */
  note: string
  /** The open project, an opaque id. Null reads the failed checks of every project. */
  projectId: string | null
}

/** The exact text that would be shared. */
export interface DiagnosticsReport {
  text: string
  bytes: number
  lines: number
  /** The release line (`v0.13.2 · build 1424 · …`), for the email and issue titles. */
  release: string
}

export interface SaveDiagnosticsRequest {
  /** The report text shown in the preview. Main removes secrets from it again before writing. */
  text: string
}

/** `diagnostics:save`: the file name that was saved, or null when the dialog was closed. */
export type SaveDiagnosticsResult = { saved: true; filename: string } | { saved: false }

/** `diagnostics:send`: the same options as a build, plus the person's consent. */
export interface SendDiagnosticsRequest extends BuildDiagnosticsRequest {
  /** Must be true: the person ticked "I understand this report (shown above) is sent …". */
  consent: boolean
  /** The report text shown in the preview. Cleaned again in main. Absent: main builds it. */
  text?: string
}

/**
 * Why a send did not go through. `offline` is a build that never contacts the server, or no
 * network; `network` is a failed call; the rest are the server's own words
 * (`token`, `invalid`, `size`, `rate`, `busy`, `redirect`, `unreadable`, `http-NNN`).
 * In every case the report is not lost: the person saves it or emails it.
 */
export type SendDiagnosticsResult = { ok: true; reportId: string } | { ok: false; error: string }

export interface OpenReportMailRequest {
  /** The "What happened?" note. Only its first lines go into the short email body. */
  note: string
}

/** A folder or mail window that did not open, with a plain reason. */
export type DiagnosticsOpenResult = { ok: true } | { ok: false; reason: string; nextStep: string }

/** Help menu items the window carries out (`diagnostics:menu`): the drawer and the tour. */
export const DIAGNOSTICS_MENU_COMMANDS = ['report-problem', 'watch-tour'] as const

export type DiagnosticsMenuCommand = (typeof DIAGNOSTICS_MENU_COMMANDS)[number]

export interface DiagnosticsMenuEvent {
  command: DiagnosticsMenuCommand
}

/** Invoke channels for this area. Each one is declared here only. */
export const diagnosticsChannels = {
  'diagnostics:build': invokeWith<BuildDiagnosticsRequest, DiagnosticsReport>(),
  'diagnostics:send': invokeWith<SendDiagnosticsRequest, SendDiagnosticsResult>(),
  'diagnostics:save': invokeWith<SaveDiagnosticsRequest, SaveDiagnosticsResult>(),
  'diagnostics:reveal-logs': invoke<DiagnosticsOpenResult>(),
  'diagnostics:open-mail': invokeWith<OpenReportMailRequest, DiagnosticsOpenResult>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const diagnosticsEvents = {
  'diagnostics:menu': push<DiagnosticsMenuEvent>()
} as const satisfies PushChannelSpecs
