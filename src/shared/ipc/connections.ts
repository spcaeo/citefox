/** Connections overview and the Claude Code checkup and terminal. */

import type {
  AiCliProvider,
  ApiKeyMetadata,
  ConnectionActivity,
  ConnectionActivityLog,
  ConnectionState,
  ProjectClaudeRow,
  SerpApiRotationMode
} from '../domain'
import {
  invoke,
  invokeWith,
  push,
  type InvokeChannelSpecs,
  type PushChannelSpecs
} from './contract'

/**
 * Connections metadata for the status capsule and the Connections screen.
 * No secrets (FR-11.11). `claudeCode` is the single Claude Code login (LLM-9),
 * separate from Anthropic API keys, which use `ApiKeyMetadata` with provider `anthropic`.
 * `searchesLeft` and `issueCount` match `StatusCapsule` (FR-24.1).
 */
export interface ConnectionsOverview {
  serpapiRotation: SerpApiRotationMode
  keys: readonly ApiKeyMetadata[]
  serpapi: ConnectionState
  claudeCode: ConnectionState
  jina: ConnectionState
  youtube: ConnectionState
  /** Last Run checkup. Null until one has been run (LLM-8). */
  claudeCheckup: ClaudeCheckupResult | null
  /**
   * SerpApi searches still available this month.
   * Null when no tested key has a plan allowance or a cap.
   */
  searchesLeft: number | null
  /** Connection-level `warning` states among the four fields above. `off` and `unchecked` are not issues. */
  issueCount: number
}

const CHECKUP_PHASES = ['binary', 'login', 'roundTrip'] as const

export type ClaudeCheckupPhase = (typeof CHECKUP_PHASES)[number]

const CHECKUP_ROW_STATES = ['ok', 'warning', 'skipped'] as const

export type ClaudeCheckupRowState = (typeof CHECKUP_ROW_STATES)[number]

const CHECKUP_PROGRESS_STATES = ['running', 'ok', 'warning', 'skipped'] as const

export type ClaudeCheckupProgressState = (typeof CHECKUP_PROGRESS_STATES)[number]

/** One row on the Claude Code check screen. */
export interface ClaudeCheckupRow {
  state: ClaudeCheckupRowState
  /** Short label, such as "OK", "Not logged in", or "Skipped". */
  statusLabel: string
  /** Second line under the row title. */
  detail: string
  /** NFR-10. Null when nothing is asked of the user. */
  nextStep: string | null
}

/**
 * LLM-1 and LLM-8. Path, version, login, and one round-trip.
 * `plan` is a name such as "Claude Max", never a remaining balance (FR-24.3).
 * `ready` is true only when all three rows are `ok`.
 * `api_key` means the CLI is logged in with an API key only, not a subscription.
 * The engine stores that value. It does not map it to `logged_out`.
 */
export interface ClaudeCheckupResult {
  /**
   * The program this checkup ran: Claude Code, or the OpenAI Codex CLI. Absent on
   * checkups saved before Codex was an option, which were all Claude Code.
   */
  provider?: AiCliProvider
  binaryPath: string | null
  version: string | null
  login: 'logged_in' | 'logged_out' | 'api_key' | 'skipped'
  plan: string | null
  roundTrip: 'ok' | 'failed' | 'skipped'
  /** Milliseconds for the test call. Null when it did not run. */
  durationMs: number | null
  /**
   * Model id the round-trip CLI reported in `modelUsage`.
   * When several models appear, this is the key with the most output tokens.
   * Null when the round trip did not run or `modelUsage` is absent.
   */
  resolvedModel: string | null
  ready: boolean
  /** Banner sentence. */
  message: string
  /** NFR-10 next step for the banner. Null when `ready` is true. */
  nextStep: string | null
  rows: {
    binary: ClaudeCheckupRow
    login: ClaudeCheckupRow
    roundTrip: ClaudeCheckupRow
  }
}

/** Pushed while `claudeCode:runCheckup` is in flight, once per phase change. */
export interface ClaudeCheckupProgress {
  phase: ClaudeCheckupPhase
  state: ClaudeCheckupProgressState
  detail: string
  /** NFR-10. Null unless `state` is `warning`. */
  nextStep: string | null
}

/**
 * Path to try for this run. Null uses the saved Settings path, or PATH and
 * the usual install folders when that saved path is null (LLM-1).
 * This request does not change Settings. Saving the override is `settings:update`.
 */
export interface RunClaudeCheckupRequest {
  binaryPath: string | null
  /**
   * Which program to check. Absent checks the one Settings chose (`claudeProvider`;
   * an Anthropic API key setting checks Claude Code, as before).
   */
  provider?: AiCliProvider
}

/** LLM-2. CiteFox opens a terminal. It does not run `claude` login itself. */
export interface OpenTerminalResult {
  opened: boolean
  /** NFR-10. Set when the terminal did not open. */
  message: string
}

export function isClaudeCheckupPhase(value: string): value is ClaudeCheckupPhase {
  return CHECKUP_PHASES.some((item) => item === value)
}

export function isClaudeCheckupRowState(value: string): value is ClaudeCheckupRowState {
  return CHECKUP_ROW_STATES.some((item) => item === value)
}

export function isClaudeCheckupProgressState(value: string): value is ClaudeCheckupProgressState {
  return CHECKUP_PROGRESS_STATES.some((item) => item === value)
}

/**
 * LLM-10. Claude Code is paused after a plan limit: every call fails at once until
 * `until`. Screens use it to hold "Try again" until then instead of failing again.
 */
export interface ClaudePauseInfo {
  /** ISO time calls may start again: the reset Claude gave plus a small margin. */
  until: string
  /** ISO reset time Claude gave, or null when it gave none. */
  resetsAt: string | null
  kind: 'session' | 'weekly' | 'unknown'
  /** "Sunday, Nov 1 at 7:00 AM" or "today at 7:30 PM", in this computer's time. */
  availableAgain: string
  /** False when no Anthropic API key is saved, so "Use an API key instead" is offered. */
  hasApiKey: boolean
}

/** `claudeCode:getPause`. The project whose connection the screen uses; null for Settings'. */
export interface ClaudePauseRequest {
  projectId: string | null
}

/** Pushed when a pause starts or ends early (a reply came back). Ask again for the details. */
export interface ClaudePauseChange {
  paused: boolean
}

/** Invoke channels for this area. Each one is declared here only. */
export const connectionsChannels = {
  'connections:getOverview': invoke<ConnectionsOverview>(),
  'claudeCode:runCheckup': invokeWith<RunClaudeCheckupRequest, ClaudeCheckupResult>(),
  'claudeCode:getCheckup': invoke<ClaudeCheckupResult | null>(),
  'claudeCode:openTerminal': invoke<OpenTerminalResult>(),
  /** LLM-10. The pause after a plan limit for this project's connection, or null. */
  'claudeCode:getPause': invokeWith<ClaudePauseRequest, ClaudePauseInfo | null>(),
  /** FR-11.10. Last 24 hours and the latest failover event. */
  'connections:activity': invoke<ConnectionActivity>(),
  /** FR-11.10 drill-down: the rows behind every activity number, and this month per key and project. */
  'connections:activityLog': invoke<ConnectionActivityLog>(),
  /** FR-11.7. Each project's Claude connection and fallback. Set with `projectSettings:update`. */
  'connections:projectClaude': invoke<readonly ProjectClaudeRow[]>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const connectionsEvents = {
  'claudeCode:checkupProgress': push<ClaudeCheckupProgress>(),
  'claudeCode:pauseChanged': push<ClaudePauseChange>()
} as const satisfies PushChannelSpecs
