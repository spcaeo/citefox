/**
 * Per-project settings that are not part of the profile (FR-10.3, FR-11.4, FR-11.7, LLM-10),
 * project usage (FR-10.6), and connection activity (FR-11.10). No secrets.
 */

import type { CapRule } from './queue'
import { isOneOf } from './one-of'

/**
 * FR-11.7. Which Claude connection a project uses.
 * `app_default` follows Settings. `claude_code` is the one Claude Code login on this
 * computer (LLM-9). `api_key` is a named Anthropic API key, named by `keyId`.
 */
const PROJECT_CLAUDE_CONNECTIONS = ['app_default', 'claude_code', 'api_key'] as const

export type ProjectClaudeConnection = (typeof PROJECT_CLAUDE_CONNECTIONS)[number]

/**
 * FR-11.7 and LLM-10. What happens when the project's connection hits a limit or fails.
 * `wait` waits for the plan limit to reset and finishes the analysis then.
 * `switch_key` moves the call to the named API key in `fallbackKeyId`.
 * `retry_later` tries again a little later. `ask` stops and asks the user.
 * Searches already made are kept in every case, so nothing is paid for twice.
 */
const CLAUDE_FALLBACKS = ['wait', 'switch_key', 'retry_later', 'ask'] as const

export type ClaudeFallback = (typeof CLAUDE_FALLBACKS)[number]

/** FR-11.4. Shared keys up to the project's cap, or one dedicated key. */
const SEARCH_SOURCES = ['shared', 'dedicated'] as const

export type SearchSource = (typeof SEARCH_SOURCES)[number]

export const DEFAULT_CLAUDE_FALLBACK: ClaudeFallback = 'wait'

/** FR-11.7, LLM-5. Stored in the project database. */
export interface ProjectClaudeSettings {
  connection: ProjectClaudeConnection
  /** Set only when `connection` is `api_key`. An `api_keys.id`, never a secret. */
  keyId: string | null
  fallback: ClaudeFallback
  /** Set only when `fallback` is `switch_key`. An `api_keys.id`. */
  fallbackKeyId: string | null
  /** Null uses the app model from Settings (LLM-5). */
  model: string | null
}

/** FR-11.4. `dedicatedKeyId` is set only when `source` is `dedicated`. */
export interface ProjectSearchSettings {
  source: SearchSource
  /** Monthly cap on shared keys. Null means no project cap. */
  cap: number | null
  capRule: CapRule
  dedicatedKeyId: string | null
}

/** One per-project template choice (TPL-1). `templateId` is an app template of that kind. */
export interface ProjectTemplateOverride {
  kind: string
  templateId: string
}

export function defaultProjectClaudeSettings(): ProjectClaudeSettings {
  return {
    connection: 'app_default',
    keyId: null,
    fallback: DEFAULT_CLAUDE_FALLBACK,
    fallbackKeyId: null,
    model: null
  }
}

export function isProjectClaudeConnection(value: string): value is ProjectClaudeConnection {
  return isOneOf(PROJECT_CLAUDE_CONNECTIONS, value)
}

export function isClaudeFallback(value: string): value is ClaudeFallback {
  return isOneOf(CLAUDE_FALLBACKS, value)
}

export function isSearchSource(value: string): value is SearchSource {
  return isOneOf(SEARCH_SOURCES, value)
}

/**
 * FR-10.6. One project's usage this month. Searches are `key_usage` rows, so they
 * add up to the Connections and Results numbers (SERP-6, NFR-14).
 */
export interface ProjectUsageRow {
  projectId: string
  name: string
  clientName: string | null
  status: 'active' | 'paused' | 'archived'
  source: SearchSource
  /** Searches this month across every key. */
  searches: number
  /** Searches this month on shared keys (not the dedicated key). */
  sharedSearches: number
  cap: number | null
  capRule: CapRule
  /** The cap plus the 10% extra when the rule is `allow_10`. Null without a cap. */
  allowance: number | null
  dedicatedKeyId: string | null
  /** Share of all shared-key capacity this project used, 0–100. Null when capacity is unknown. */
  sharePercent: number | null
  /** Claude calls this month, every connection. */
  claudeCalls: number
  /** Connection label, such as "Claude Code" or "Anthropic API · My key". */
  claudeLabel: string
}

/** FR-10.6. `unassigned` is shared capacity no project cap has promised. */
export interface ProjectUsageReport {
  /** `YYYY-MM` in the computer's timezone. */
  month: string
  projects: readonly ProjectUsageRow[]
  /** Searches this month on shared keys, every project and no project. */
  sharedUsed: number
  /** Sum of the shared keys' monthly limits. Null when any shared key has no limit. */
  sharedCapacity: number | null
  /** Shared capacity minus the caps of projects on shared keys. Null when capacity or a cap is unknown. */
  unassigned: number | null
  /** Searches this month on dedicated keys. */
  dedicatedUsed: number
  /** Claude calls this month, every project. */
  claudeCalls: number
}

export type ActivityProvider = 'serpapi' | 'claude' | 'jina'

/** FR-11.10. The latest failover or limit event, said in plain words. */
export interface ConnectionActivityEvent {
  /** ISO-8601 UTC. */
  at: string
  provider: ActivityProvider
  sentence: string
}

/** FR-11.10. Counts for the last 24 hours. */
export interface ConnectionActivity {
  /** ISO-8601 UTC start of the window. */
  since: string
  searches: number
  claudeCalls: number
  jinaReads: number
  latestEvent: ConnectionActivityEvent | null
}

/** What one activity row records (FR-11.10). The last three are notices told in plain words. */
export type ActivityLogKind =
  'search' | 'claude_call' | 'jina_read' | 'claude_limit' | 'claude_fallback' | 'jina_failover'

/** One recorded call or notice in the last 24 hours (FR-11.10 drill-down). No secrets. */
export interface ActivityLogEntry {
  id: string
  /** ISO-8601 UTC. */
  at: string
  kind: ActivityLogKind
  keyId: string | null
  /** The key's name, or null when there is no key or it was removed. */
  keyName: string | null
  projectId: string | null
  /** The project's name, or null when there is no project or it was removed. */
  projectName: string | null
  /** Searches for `search` (a call can make more than one), otherwise 1. */
  count: number
  /** Plain words, redacted. Null for counts. */
  detail: string | null
}

/** One stored key event behind the latest failover sentence (FR-11.10). */
export interface ActivityKeyEvent {
  id: string
  /** ISO-8601 UTC. */
  at: string
  provider: ActivityProvider
  /** `rate_limited`, `failover`, `cap_reached` or `failed` for a key; a notice kind otherwise. */
  kind: string
  keyId: string | null
  keyName: string | null
  /** Plain words, redacted. */
  detail: string | null
}

/** Searches this month on one key for one project (`key_usage`, SERP-6). */
export interface KeyProjectUsage {
  keyId: string
  /** Null for searches outside any project, such as the playground. */
  projectId: string | null
  projectName: string | null
  searches: number
}

/**
 * `connections:activityLog`: the rows behind every Connections activity number.
 * The counts are summed from `entries`, so a drawer of entries always matches them.
 */
export interface ConnectionActivityLog extends ConnectionActivity {
  /** Newest first: every search, Claude call, Jina read and notice since `since`. */
  entries: readonly ActivityLogEntry[]
  /** The events the `latestEvent` sentence tells, newest first. Empty when there is none. */
  latestEvents: readonly ActivityKeyEvent[]
  /** `YYYY-MM` in the computer's timezone. */
  month: string
  /** `YYYY-MM-DD` when this month's counts restart. */
  resetsOn: string
  /** Searches this month per key and project. Sums per key equal `usedThisMonth`. */
  keyMonth: readonly KeyProjectUsage[]
  /** Stored key events (limits, failures, caps, failovers) in the last 30 days, newest first. */
  keyEvents: readonly ActivityKeyEvent[]
}

/** One row of "Which connection each project uses" on Connections (FR-11.7). */
export interface ProjectClaudeRow {
  projectId: string
  name: string
  clientName: string | null
  claude: ProjectClaudeSettings
}

/**
 * FR-10.9. A domain AI Overviews cited instead of the project's own domain.
 * `likelyCompetitor` is false for carrier, help, encyclopedia, and community pages.
 */
export interface CompetitorCandidate {
  domain: string
  /** Overviews (prompt captures) that cited this domain. */
  overviews: number
  /** References to this domain across those overviews. */
  citations: number
  likelyCompetitor: boolean
  /** Plain words, such as "Carrier help page, probably not a competitor". */
  reason: string
  /** Already on the project's competitor list. */
  listed: boolean
  /**
   * The overviews behind `overviews`, one per overview (drill-down, NFR-14):
   * its length equals `overviews`. Absent from older engines.
   */
  overviewRefs?: readonly CompetitorOverviewRef[]
}

/** One AI Overview (prompt capture) that cited a candidate domain. */
export interface CompetitorOverviewRef {
  /** `serp_results.id`. */
  overviewId: string
  pageId: string
  /** Page label, title or URL. */
  pageLabel: string
  promptId: string
  promptLabel: string
  promptPosition: number
  marketId: string
  runId: string
  /** ISO-8601 UTC start of the check. */
  checkedAt: string
  /** The first link to the domain in that overview. */
  url: string
  /** Links to the domain in that overview. */
  citations: number
}

export interface CompetitorFindings {
  projectId: string
  domain: string
  /** Overviews read. Zero before the first check. */
  overviewsRead: number
  /** ISO-8601 UTC of the latest capture read, or null before the first check. */
  latestCheckAt: string | null
  candidates: readonly CompetitorCandidate[]
  /** NFR-10. Set when there is nothing to show. */
  nextStep: string | null
}
