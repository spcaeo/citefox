/** API keys, Claude connections, and connection states (no secrets). */

import { isOneOf } from './one-of'

/**
 * `api_keys.provider` (section 10). Claude Code login is not a row in this table
 * (section 5, LLM-2, LLM-9). The Anthropic API key row uses `anthropic`.
 * The connection id `anthropic-api` (section 5.1) is `ClaudeProvider`, not this list.
 */
const API_KEY_PROVIDERS = ['serpapi', 'cloro', 'jina', 'anthropic', 'youtube'] as const

export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number]

/**
 * Section 5.1. The AI connection the app runs its analysis with: the Claude Code
 * login, an Anthropic API key, or the OpenAI Codex CLI login (Docs/AI-PROVIDERS.md).
 * The name stays `ClaudeProvider` because settings and storage already use it.
 */
const CLAUDE_PROVIDERS = ['claude-code', 'anthropic-api', 'codex'] as const

export type ClaudeProvider = (typeof CLAUDE_PROVIDERS)[number]

/** A program on this computer that CiteFox runs for its AI work (not an API key). */
export type AiCliProvider = Extract<ClaudeProvider, 'claude-code' | 'codex'>

/** The product name of a connection, for status chips and notices: "Claude Code", "Codex". */
export function aiProviderName(provider: ClaudeProvider): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'anthropic-api') return 'Anthropic API'
  return 'Claude Code'
}

/** The AI's own name in a sentence ("Asking Codex to …"): "Claude" or "Codex". */
export function aiAssistantName(provider: ClaudeProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude'
}

/**
 * FR-11.2.
 * `in_order` — each key up to its cap, then the next (the default).
 * `spread_evenly` — spread evenly on every search.
 * `project_keys` — only the keys assigned to each project.
 */
const SERPAPI_ROTATION_MODES = ['in_order', 'spread_evenly', 'project_keys'] as const

export type SerpApiRotationMode = (typeof SERPAPI_ROTATION_MODES)[number]

/**
 * FR-24.2 plus the lead decision for a key that has never been tested.
 * `unchecked` is that untested key. It is not an open issue.
 */
const CONNECTION_STATES = ['ok', 'warning', 'off', 'unchecked'] as const

export type ConnectionState = (typeof CONNECTION_STATES)[number]

/**
 * Why a key test or provider call did not come back `ok`.
 * `rejected` is 401 or 403. `out_of_searches` is a SerpApi plan with nothing left.
 * `rate_limited` is 429 after retries. `timeout` is the call timing out.
 * `other` is a malformed body, a missing keychain item, a network error, or anything else.
 * Stored on `api_keys.last_reason` and returned as `KeyTestResult.reason`.
 */
export const KEY_TEST_REASONS = [
  'rejected',
  'out_of_searches',
  'rate_limited',
  'timeout',
  'other'
] as const

export type KeyTestReason = (typeof KEY_TEST_REASONS)[number]

/**
 * FR-2.5. `fallback` is only when a normal fetch fails (the default).
 * `always` and `never` are the other two modes.
 */
const JINA_MODES = ['fallback', 'always', 'never'] as const

export type JinaMode = (typeof JINA_MODES)[number]

/** LLM-7. "Calls at once" defaults to 2. */
export const DEFAULT_CLAUDE_CONCURRENCY = 2

/** FR-2.5. */
export const DEFAULT_JINA_MODE: JinaMode = 'fallback'

/** Section 5.1. The default Claude connection. */
export const DEFAULT_CLAUDE_PROVIDER: ClaudeProvider = 'claude-code'

/**
 * FR-11.2. The rotation mode before the user changes it (`settings:update`).
 */
export const DEFAULT_SERPAPI_ROTATION: SerpApiRotationMode = 'in_order'

/**
 * Last characters of a secret shown as a mask, such as ••••4f2a.
 * The value is those characters only, never the secret (NFR-5).
 */
export const API_KEY_HINT_LENGTH = 4

/**
 * SerpApi account usage for the current month (SERP-7).
 * Read when a key is tested. This is the plan's allowance, not the user's cap.
 */
export interface SerpApiUsage {
  /** Searches used this month. */
  used: number
  /** Plan allowance this month. Null when the account endpoint did not report one. */
  planLimit: number | null
  /** Plan name from the account endpoint, such as "Developer". Null when not reported. */
  plan: string | null
}

/**
 * A cloro key's credit balance, read by the key test (`GET /v1/credits`, free).
 * `perCycle` and `resetsAt` are null on cloro's free tier.
 */
export interface CloroCredits {
  remaining: number
  perCycle: number | null
  resetsAt: string | null
}

/**
 * `api_keys` metadata. `keychainRef` identifies the keychain item.
 * `hint` is the masked tail. The secret itself is not here.
 */
export interface ApiKeyMetadata {
  id: string
  provider: ApiKeyProvider
  name: string
  keychainRef: string
  /** Last {@link API_KEY_HINT_LENGTH} characters. Empty when the secret is shorter than that. */
  hint: string
  rotationOrder: number
  /** Null means no cap (lead decision). */
  cap: number | null
  on: boolean
  /** Empty means the key is available to every project (lead decision). */
  projectIds: readonly string[]
  /** `unchecked` until the first test. */
  state: ConnectionState
  /**
   * Last failed key test or provider call. Required on every key.
   * Null when `state` is `ok`, `unchecked`, or `off`.
   * Set when `state` is `warning`, to the same codes as `KeyTestResult.reason`.
   */
  lastReason: KeyTestReason | null
  /** Set for a SerpApi key after a test that reported usage. Null otherwise. */
  serpapiUsage: SerpApiUsage | null
  /** Set for a cloro key after a test that read its balance. Null or absent otherwise. */
  cloroCredits?: CloroCredits | null
  /**
   * User-entered plan name (FR-11.1). Null when unset.
   * IPC fills this on every key. A SerpApi account plan is used only when the user has not set one.
   */
  plan?: string | null
  /**
   * Bullets plus the stored hint, such as ••••4f2a.
   * Built from `hint` only. Never the secret (NFR-5). IPC fills this on every key.
   */
  maskedKey?: string
  /** Same value as `on`. IPC fills this on every key. */
  enabled?: boolean
  /** Same value as `cap`. Null means no cap. IPC fills this on every key. */
  monthlyCap?: number | null
  /** SerpApi plan allowance (`serpapi_limit`). Null for other providers and before a test. */
  planLimit?: number | null
  /**
   * Searches recorded for this month (SERP-6). Worked out when the key is read.
   * Compared with the lower of `monthlyCap` and `planLimit` when both are set.
   */
  usedThisMonth?: number
  /** Stored `state`. One of ok, warning, off, or unchecked. IPC fills this on every key. */
  status?: ConnectionState
  /**
   * Plain words for the key, or null.
   * A stored warning uses the last failure (auth failed, rate limited, and so on).
   * An ok key near the effective monthly limit says so.
   */
  statusDetail?: string | null
}

export function isApiKeyProvider(value: string): value is ApiKeyProvider {
  return isOneOf(API_KEY_PROVIDERS, value)
}

export function isClaudeProvider(value: string): value is ClaudeProvider {
  return isOneOf(CLAUDE_PROVIDERS, value)
}

export function isSerpApiRotationMode(value: string): value is SerpApiRotationMode {
  return isOneOf(SERPAPI_ROTATION_MODES, value)
}

export function isConnectionState(value: string): value is ConnectionState {
  return isOneOf(CONNECTION_STATES, value)
}

export function isJinaMode(value: string): value is JinaMode {
  return isOneOf(JINA_MODES, value)
}
