/**
 * AI assists (FR-25.1 to FR-25.6): one channel pair for every assist button.
 * A screen names an assist id and passes its inputs. Main renders that assist's
 * shipped prompt with the shared output rules, calls the project's Claude
 * connection, validates the reply against the assist's schema, and logs the
 * call in `llm_calls`. Nothing is written to the project: Apply, Add and Undo
 * are the screen's own channels, run only when the user picks them (FR-25.2).
 */

import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'

/**
 * Assists shipped with this contract. Screens owned by other areas may register
 * more ids in main; the channel takes any string and rejects an unknown one.
 */
export const ASSIST_IDS = [
  'page.shorterTitle',
  'page.promises',
  'page.checkFacts',
  'page.verifyClaims',
  'audience.sharpen',
  'audience.triggers',
  'prompts.more',
  'prompts.rephrase',
  'prompts.checkPage',
  'gaps.draftFix',
  'results.explainChange',
  'results.topActions',
  'results.whyNotFirst',
  'results.overviewRead',
  'progress.nextFix',
  'progress.otherMarkets',
  'progress.draftFix',
  'markets.suggest',
  'markets.localPrompts',
  'markets.whatsDifferent',
  'status.explainUsage',
  'status.explainErrors',
  'report.summary',
  'template.improve',
  'communities.reply',
  'fixes.anchorText',
  'fixes.recoveryPlan',
  'citations.pitch',
  'alerts.describeRule'
] as const

export type KnownAssistId = (typeof ASSIST_IDS)[number]

/** Values a screen may pass. Text is capped by main; secrets are rejected. */
export type AssistInputValue = string | number | boolean | null | readonly string[]

export type AssistInputs = Readonly<Record<string, AssistInputValue>>

/** Most characters of a "Tell Claude what to change…" instruction. */
export const ASSIST_INSTRUCTION_MAX = 1000

/**
 * FR-25.1. "Claude · on your plan · about 6 s".
 * `expectedSeconds` comes from this assist's `llm_calls` history, or the assist's
 * shipped estimate when there is none yet.
 */
export interface AssistLabel {
  connection: 'claude-code' | 'anthropic-api' | 'codex'
  /** "Claude · on your plan" or "Claude · Anthropic API key". */
  connectionText: string
  expectedSeconds: number
  /** The full label, connection and duration together. */
  text: string
}

export interface AssistDescribeRequest {
  assistId: string
  projectId: string | null
}

/** What a screen shows on an assist button before it runs. */
export interface AssistDescription {
  assistId: string
  title: string
  label: AssistLabel
  /** FR-25.4. True when the assist reads saved data only ("No new searches"). */
  savedDataOnly: boolean
  /** SerpApi searches the assist would spend. Always 0 for the shipped assists. */
  searchCost: number
  /** FR-25.3. True when "Tell Claude what to change…" applies. */
  acceptsInstruction: boolean
}

export interface AssistRunRequest {
  assistId: string
  /** Null for an assist with no project (Status). */
  projectId: string | null
  pageId: string | null
  marketId: string | null
  promptId: string | null
  /** Assist-specific values, such as the prompt to rephrase or a fix number. */
  inputs: AssistInputs
  /** FR-25.3. Null or empty runs the assist as shipped. */
  instruction: string | null
}

/**
 * One suggestion. `text` is what Copy copies and what Apply or Add hands back to
 * the screen. `verify` marks a fact to re-check (FR-25.5): dates, prices, limits.
 * Unconfirmed details stay inside [brackets] in `text` and `detail`.
 */
export interface AssistItem {
  id: string
  text: string
  detail: string | null
  /** Short tag such as an intent stage, a coverage level, or a market. */
  tag: string | null
  /** A fact to re-verify before using it, in plain words. Null when there is none. */
  verify: string | null
  /** For line proposals (Improve this template): add or remove this line. */
  sign: 'add' | 'remove' | null
}

export interface AssistResult {
  runId: string
  assistId: string
  title: string
  /** A short paragraph above the items. Null when the assist only lists items. */
  summary: string | null
  items: readonly AssistItem[]
  /** A caution under the items, such as "Re-check the prices marked below". */
  caution: string | null
  label: AssistLabel
  savedDataOnly: boolean
  /** SerpApi searches spent. 0 for every shipped assist. */
  searchesUsed: number
  durationMs: number
  /** Model that answered, when the connection reports it. */
  model: string | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const assistChannels = {
  'assist:describe': invokeWith<AssistDescribeRequest, AssistDescription>(),
  'assist:run': invokeWith<AssistRunRequest, AssistResult>()
} as const satisfies InvokeChannelSpecs

/**
 * Live progress for every AI assist and long Claude step (owner feedback #1).
 * Main pushes one event each time a step starts or ends, at real boundaries:
 * a page read (with its path, and Jina, a direct read or a saved copy), a Claude
 * call (with the connection and model), the check of Claude's answer and its
 * retry, and the result count. Events never carry page text, prompts, replies,
 * keys or tokens: a label, a short detail and timestamps only.
 */
export const ASSIST_STEP_STATES = ['running', 'done', 'skipped', 'failed'] as const

export type AssistStepState = (typeof ASSIST_STEP_STATES)[number]

/** What a step does, for its icon: read a page, reuse a saved copy, ask Claude, check, result. */
export const ASSIST_STEP_KINDS = ['read', 'cache', 'claude', 'check', 'result', 'work'] as const

export type AssistStepKind = (typeof ASSIST_STEP_KINDS)[number]

/** The connection a Claude step runs on. Never a key or a token. */
export interface AssistProgressClaude {
  connection: 'claude-code' | 'anthropic-api' | 'codex'
  /** "Claude · on your plan" or "Claude · Anthropic API key". */
  connectionText: string
  /** The model asked for, then the model that answered when the connection reports it. */
  model: string | null
}

export interface AssistProgress {
  /** One invoke in main. A screen that makes several calls sees several runs. */
  runId: string
  /** The invoke channel the run serves, such as `assist:run` or `topics:discoverSeed`. */
  channel: string
  /** Tells runs on one channel apart: the assist id, the draft id, or the domain. */
  scope: string | null
  /** Stable within the run; a later event with the same id updates the step. */
  stepId: string
  kind: AssistStepKind
  /** "Reading /pricing", "Asking Claude to find brand names and competitors". */
  label: string
  state: AssistStepState
  /** "Read · 820 words", "Saved copy", "Not found". Null when there is none. */
  detail: string | null
  /** Epoch milliseconds. */
  startedAt: number
  /** Epoch milliseconds once the step left `running`; null while it runs. */
  endedAt: number | null
  /** Set on `claude` steps only. */
  claude: AssistProgressClaude | null
}

/** Push events for this area. */
export const assistEvents = {
  'assist:progress': push<AssistProgress>()
} as const satisfies PushChannelSpecs
