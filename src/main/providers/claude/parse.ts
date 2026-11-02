import { redactString } from '../../logging/redact'
import { isRecord, schemaError } from '../json-schema'
import {
  classifyClaudeFailure,
  limitReplyOnly,
  looksLimited,
  looksSignedOut,
  type ClaudeLimitInfo
} from './limits'

const VERSION = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/

export function parseClaudeVersion(stdout: string): string | null {
  const match = VERSION.exec(stdout)
  const version = match?.[1]
  return version ?? null
}

/** Failure text that says Claude Code is signed out. See `limits.ts` for every pattern. */
export function looksLoggedOut(text: string): boolean {
  return looksSignedOut(text)
}

/** Failure text that names a plan limit or a rate limit (never a sign-in problem). */
export function looksLikeLimit(text: string): boolean {
  return looksLimited(text)
}

export type LoginProbe =
  | { status: 'logged_in'; plan: string | null; authMethod: string }
  | { status: 'logged_out'; detail: string }
  | { status: 'api_key'; detail: string }
  | { status: 'unknown'; detail: string }

/**
 * Reads login state from `claude auth status` JSON. Email, org, and tokens
 * are ignored (LLM-2, section 5.3). Plan is a name only (FR-24.3).
 */
export function parseAuthStatus(stdout: string, stderr: string): LoginProbe {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch {
    if (looksLoggedOut(`${stdout}\n${stderr}`)) {
      return {
        status: 'logged_out',
        detail: 'Claude Code is installed, but no account is logged in.'
      }
    }
    return {
      status: 'unknown',
      detail: 'CiteFox could not read the Claude Code login status.'
    }
  }
  if (!isRecord(parsed) || typeof parsed.loggedIn !== 'boolean') {
    return {
      status: 'unknown',
      detail: 'CiteFox could not read the Claude Code login status.'
    }
  }
  if (!parsed.loggedIn) {
    return {
      status: 'logged_out',
      detail: 'Claude Code is installed, but no account is logged in.'
    }
  }
  const authMethod = typeof parsed.authMethod === 'string' ? parsed.authMethod : 'unknown'
  const apiKeySource = typeof parsed.apiKeySource === 'string' ? parsed.apiKeySource : null
  if (authMethod === 'api_key' || apiKeySource === 'ANTHROPIC_API_KEY') {
    return {
      status: 'api_key',
      detail: 'Claude Code is using an API key, not a subscription login.'
    }
  }
  const subscription = typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : null
  return { status: 'logged_in', plan: planName(subscription), authMethod }
}

export function planName(subscriptionType: string | null): string | null {
  if (subscriptionType === null) return null
  const known: Readonly<Record<string, string>> = {
    pro: 'Claude Pro',
    max: 'Claude Max',
    team: 'Claude Team',
    enterprise: 'Claude Enterprise'
  }
  const mapped = known[subscriptionType.toLowerCase()]
  if (mapped !== undefined) return mapped
  if (/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}$/.test(subscriptionType)) return subscriptionType
  return null
}

/** Per-model counts from CLI `modelUsage` (camelCase, as `--output-format json` emits). */
export interface ClaudeModelTokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  cacheCreationInputTokens: number | null
  cacheReadInputTokens: number | null
  costUsd: number | null
}

/**
 * One `claude -p --output-format json` result.
 * `usage` uses the CLI's snake_case token fields. `modelUsage` is keyed by model id.
 */
export interface ClaudeCliUsage {
  inputTokens: number | null
  outputTokens: number | null
  cacheCreationInputTokens: number | null
  cacheReadInputTokens: number | null
  totalCostUsd: number | null
  modelUsage: Readonly<Record<string, ClaudeModelTokenUsage>>
}

export function emptyClaudeCliUsage(): ClaudeCliUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
    totalCostUsd: null,
    modelUsage: {}
  }
}

/** Token counts from several attempts added together. Null only when every attempt was null. */
export function sumClaudeCliUsage(usages: readonly (ClaudeCliUsage | null)[]): ClaudeCliUsage {
  const total = emptyClaudeCliUsage()
  const modelUsage: Record<string, ClaudeModelTokenUsage> = {}
  for (const usage of usages) {
    if (usage === null) continue
    total.inputTokens = addCount(total.inputTokens, usage.inputTokens)
    total.outputTokens = addCount(total.outputTokens, usage.outputTokens)
    total.cacheCreationInputTokens = addCount(
      total.cacheCreationInputTokens,
      usage.cacheCreationInputTokens
    )
    total.cacheReadInputTokens = addCount(total.cacheReadInputTokens, usage.cacheReadInputTokens)
    total.totalCostUsd = addCount(total.totalCostUsd, usage.totalCostUsd)
    for (const [model, entry] of Object.entries(usage.modelUsage)) {
      const before = modelUsage[model]
      modelUsage[model] =
        before === undefined
          ? { ...entry }
          : {
              inputTokens: addCount(before.inputTokens, entry.inputTokens),
              outputTokens: addCount(before.outputTokens, entry.outputTokens),
              cacheCreationInputTokens: addCount(
                before.cacheCreationInputTokens,
                entry.cacheCreationInputTokens
              ),
              cacheReadInputTokens: addCount(
                before.cacheReadInputTokens,
                entry.cacheReadInputTokens
              ),
              costUsd: addCount(before.costUsd, entry.costUsd)
            }
    }
  }
  return { ...total, modelUsage }
}

function addCount(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return left + right
}

/**
 * Model id from `modelUsage`: the model that wrote the final answer. When the requested
 * model (or a dated or context-size id of it) is among the keys, that one: with web search on, the
 * helper model that summarises fetched pages can write more tokens than the answer.
 * Otherwise the key with the most output tokens; a tie keeps the earlier key. Null when
 * `modelUsage` is absent or empty.
 */
export function resolvedModelId(
  modelUsage: Readonly<Record<string, { outputTokens: number | null }>> | null | undefined,
  requested: string | null = null
): string | null {
  if (modelUsage === null || modelUsage === undefined) return null
  const keys = Object.keys(modelUsage)
  const asked =
    requested === null
      ? []
      : keys.filter(
          (key) => key.startsWith(requested) && /^(?:$|[-[@])/u.test(key.slice(requested.length))
        )
  const pool = asked.length > 0 ? asked : keys
  let bestModel: string | null = null
  let bestOutput = Number.NEGATIVE_INFINITY
  for (const model of pool) {
    const usage = modelUsage[model] ?? { outputTokens: null }
    const output = usage.outputTokens === null ? Number.NEGATIVE_INFINITY : usage.outputTokens
    if (bestModel === null || output > bestOutput) {
      bestModel = model
      bestOutput = output
    }
  }
  return bestModel
}

export type CliParse =
  | {
      ok: true
      text: string
      json: unknown | null
      usage: ClaudeCliUsage
    }
  | {
      ok: false
      reason: CliFailureReason
      detail: string
      usage: ClaudeCliUsage | null
      /** For `limit`: the window and reset time Claude gave. */
      limit?: ClaudeLimitInfo
    }

export type CliFailureReason =
  | 'malformed'
  | 'logged_out'
  | 'plan_inactive'
  | 'credit_low'
  | 'unauthorized'
  | 'limit'
  | 'rate_limited'
  | 'overloaded'
  | 'error'
  | 'validation'
  | 'truncated'

/** LLM-4. JSON output, then the result field, then one schema check. */
export function parseClaudeCliOutput(
  stdout: string,
  stderr: string,
  schema: Record<string, unknown> | null,
  secrets: readonly string[],
  now: Date = new Date()
): CliParse {
  const combined = `${stdout}\n${stderr}`
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch {
    return classifyCliText(combined, secrets, null, now)
  }
  if (!isRecord(parsed)) return classifyCliText(combined, secrets, null, now)
  const usage = cliUsage(parsed)
  const resultText = cliResultText(parsed.result)
  if (cliFailed(parsed)) {
    return classifyCliFailure(
      parsed,
      `${resultText}\n${cliErrors(parsed)}\n${stderr}`,
      secrets,
      usage,
      schema,
      now
    )
  }
  // A limit line sent as a normal reply (`is_error: false`). Only a short reply that
  // is nothing but the line counts, so an answer that talks about limits is kept.
  const limitOnly =
    parsed.structured_output === undefined ? limitReplyOnly(resultText.trim(), now) : null
  if (limitOnly !== null) {
    return {
      ok: false,
      reason: 'limit',
      detail: redactString(resultText.slice(0, 300), { secrets }),
      usage,
      limit: limitOnly
    }
  }
  if (parsed.stop_reason === 'max_tokens') {
    return {
      ok: false,
      reason: 'truncated',
      detail: 'The Claude Code reply was cut off at the output token limit.',
      usage
    }
  }
  if (schema === null) {
    return { ok: true, text: resultText, json: null, usage }
  }
  const candidate =
    parsed.structured_output !== undefined ? parsed.structured_output : parseMaybeJson(resultText)
  if (candidate === undefined) {
    return {
      ok: false,
      reason: 'validation',
      detail: redactString('Claude Code did not return JSON in the result field.', { secrets }),
      usage
    }
  }
  const problem = schemaError(candidate, schema)
  if (problem !== null) {
    return { ok: false, reason: 'validation', detail: redactString(problem, { secrets }), usage }
  }
  return {
    ok: true,
    text: typeof candidate === 'string' ? candidate : JSON.stringify(candidate),
    json: candidate,
    usage
  }
}

function classifyCliText(
  text: string,
  secrets: readonly string[],
  usage: ClaudeCliUsage | null,
  now: Date
): CliParse {
  const safe = redactString(text.trim().slice(0, 300), { secrets })
  const failure = classifyClaudeFailure(text, now)
  if (failure?.kind === 'account') {
    return { ok: false, reason: failure.problem, detail: safe, usage }
  }
  if (failure?.kind === 'limit') {
    return { ok: false, reason: 'limit', detail: safe, usage, limit: failure.limit }
  }
  if (failure?.kind === 'transient') {
    return { ok: false, reason: failure.code, detail: safe, usage }
  }
  if (text.trim().length === 0) {
    return {
      ok: false,
      reason: 'malformed',
      detail: 'Claude Code returned an empty response.',
      usage
    }
  }
  return {
    ok: false,
    reason: 'malformed',
    detail: safe || 'Claude Code returned an empty response.',
    usage
  }
}

function classifyCliFailure(
  parsed: Record<string, unknown>,
  text: string,
  secrets: readonly string[],
  usage: ClaudeCliUsage,
  schema: Record<string, unknown> | null,
  now: Date
): CliParse {
  // With --json-schema the reply must arrive through the CLI's structured output tool,
  // which takes a follow-up turn (schema calls get --max-turns 2). When the model still
  // answers in plain text, the CLI ends with error_max_turns and an empty stderr. That
  // is a reply that missed the schema, so the caller's one schema retry applies.
  if (schema !== null && parsed.subtype === 'error_max_turns') {
    return {
      ok: false,
      reason: 'validation',
      detail: 'Claude Code answered in text instead of the JSON reply this step needs.',
      usage
    }
  }
  if (parsed.subtype === 'error_max_structured_output_retries') {
    const detail = redactString(text.slice(0, 300), { secrets })
    return {
      ok: false,
      reason: 'validation',
      detail: detail || 'Claude Code could not match the schema.',
      usage
    }
  }
  const classified = classifyCliText(text, secrets, usage, now)
  if (!classified.ok && classified.reason === 'malformed') {
    return { ...classified, reason: 'error' }
  }
  return classified
}

function cliFailed(parsed: Record<string, unknown>): boolean {
  if (parsed.is_error === true) return true
  const subtype = typeof parsed.subtype === 'string' ? parsed.subtype : ''
  return subtype === 'error' || subtype.startsWith('error_')
}

function cliErrors(parsed: Record<string, unknown>): string {
  if (!Array.isArray(parsed.errors)) return ''
  return parsed.errors.filter((entry): entry is string => typeof entry === 'string').join('\n')
}

function cliUsage(parsed: Record<string, unknown>): ClaudeCliUsage {
  const usage = isRecord(parsed.usage) ? parsed.usage : null
  return {
    inputTokens: numberOrNull(usage?.input_tokens),
    outputTokens: numberOrNull(usage?.output_tokens),
    cacheCreationInputTokens: numberOrNull(
      usage?.cache_creation_input_tokens ?? usage?.cache_creation
    ),
    cacheReadInputTokens: numberOrNull(usage?.cache_read_input_tokens ?? usage?.cache_read),
    totalCostUsd: numberOrNull(parsed.total_cost_usd),
    modelUsage: parseModelUsage(parsed.modelUsage)
  }
}

function parseModelUsage(value: unknown): Record<string, ClaudeModelTokenUsage> {
  if (!isRecord(value)) return {}
  const usage: Record<string, ClaudeModelTokenUsage> = {}
  for (const [model, entry] of Object.entries(value)) {
    if (!isModelId(model) || !isRecord(entry)) continue
    usage[model] = {
      inputTokens: numberOrNull(entry.inputTokens ?? entry.input_tokens),
      outputTokens: numberOrNull(entry.outputTokens ?? entry.output_tokens),
      cacheCreationInputTokens: numberOrNull(
        entry.cacheCreationInputTokens ?? entry.cache_creation_input_tokens
      ),
      cacheReadInputTokens: numberOrNull(
        entry.cacheReadInputTokens ?? entry.cache_read_input_tokens
      ),
      costUsd: numberOrNull(entry.costUSD ?? entry.cost_usd)
    }
  }
  return usage
}

function isModelId(value: string): boolean {
  if (value.length === 0 || value.length > 200 || value.trim() !== value) return false
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 31) return false
  }
  return true
}

function cliResultText(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === undefined || result === null) return ''
  return JSON.stringify(result)
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
