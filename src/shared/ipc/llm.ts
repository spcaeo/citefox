/**
 * Claude call log (FR-25.6, SRS section 10 `llm_calls`).
 * Every Claude call from the page-setup pipeline, the check reports, the
 * playground, Ask CiteFox and the assists writes one row: in the project
 * database when the call belongs to a project, otherwise in app.sqlite.
 * Prompts and replies are never stored here.
 */

import { invokeWith, type InvokeChannelSpecs } from './contract'

export const LLM_CALL_SOURCES = [
  'pipeline',
  'report',
  'assist',
  'playground',
  'ask',
  'other'
] as const

export type LlmCallSource = (typeof LLM_CALL_SOURCES)[number]

export interface LlmCallRecord {
  id: string
  /** Null for a call outside any project. */
  projectId: string | null
  connection: 'claude-code' | 'anthropic-api' | 'codex'
  model: string | null
  source: LlmCallSource
  /** Template kind when a template was rendered. */
  templateKind: string | null
  templateId: string | null
  templateHash: string | null
  /** Assist id for an assist call. */
  assistId: string | null
  /** ISO-8601 UTC. */
  startedAt: string
  durationMs: number
  tokensIn: number
  tokensOut: number
  ok: boolean
  /** Redacted failure message. Null when `ok`. */
  error: string | null
}

export interface LlmUsageRequest {
  /** Omit for every project plus calls outside projects. */
  projectId?: string
}

export interface LlmUsageByConnection {
  connection: 'claude-code' | 'anthropic-api' | 'codex'
  calls: number
  tokensIn: number
  tokensOut: number
}

/** Calls grouped by template kind or assist id ("other" when neither). */
export interface LlmUsageByStep {
  step: string
  calls: number
  failed: number
  averageDurationMs: number
}

/**
 * Status and Connections usage. "Today" and "this month" are the computer's
 * local calendar day and month.
 */
export interface LlmUsage {
  /** ISO-8601 UTC. */
  builtAt: string
  callsToday: number
  failedToday: number
  callsThisMonth: number
  tokensInThisMonth: number
  tokensOutThisMonth: number
  byConnection: readonly LlmUsageByConnection[]
  byStep: readonly LlmUsageByStep[]
  /** Newest first, at most 20. */
  recent: readonly LlmCallRecord[]
  /** Newest failed calls first, at most 10. */
  recentErrors: readonly LlmCallRecord[]
}

/** Most rows one `llm:calls` answer returns. `total` still counts every match. */
export const LLM_CALLS_LIMIT = 200

/**
 * `llm:calls`: the calls behind a step's "last run" (Templates drill-down).
 * Omit `projectId` for every project plus calls outside projects.
 */
export interface LlmCallsRequest {
  projectId?: string
  /** Template kind, such as `buyer_profile`. */
  templateKind: string
}

/** Newest first, at most {@link LLM_CALLS_LIMIT}; `total` counts every match. */
export interface LlmCallList {
  calls: readonly LlmCallRecord[]
  total: number
}

/** Invoke channels for this area. Each one is declared here only. */
export const llmChannels = {
  'llm:usage': invokeWith<LlmUsageRequest, LlmUsage>(),
  'llm:calls': invokeWith<LlmCallsRequest, LlmCallList>()
} as const satisfies InvokeChannelSpecs
