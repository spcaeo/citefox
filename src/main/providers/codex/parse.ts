import { redactString } from '../../logging/redact'
import type { ClaudeCliUsage } from '../claude/parse'
import { emptyClaudeCliUsage } from '../claude/parse'
import { isRecord, schemaError } from '../json-schema'
import { stripOptionalNulls } from './schema'

/**
 * Reads `codex exec --json` output (JSONL on stdout, codex-cli 0.149):
 * `thread.started`, `turn.started`, `item.started` / `item.completed` (items of type
 * `agent_message`, `web_search`, `reasoning`, `error`), then `turn.completed` with
 * `usage`, or `turn.failed` with `error.message`. Top-level `error` events carry
 * reconnect notices ("Reconnecting... 2/5") and the final error. An `error` item is
 * a warning (for example that code mode is off) and never fails the call by itself.
 */

const VERSION = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/

/** `codex --version` prints "codex-cli 0.149.0". */
export function parseCodexVersion(stdout: string): string | null {
  return VERSION.exec(stdout)?.[1] ?? null
}

export type CodexLoginProbe =
  | { status: 'logged_in'; plan: string | null; authMethod: string }
  | { status: 'logged_out'; detail: string }
  | { status: 'api_key'; detail: string }
  | { status: 'unknown'; detail: string }

/**
 * `codex login status` writes one line to stderr: "Logged in using ChatGPT",
 * "Logged in using an API key - sk-…", or "Not logged in" (exit 1). Only the method
 * is read; a key or token in the line is never kept.
 */
export function parseCodexLoginStatus(stdout: string, stderr: string): CodexLoginProbe {
  const text = `${stdout}\n${stderr}`
  if (/not logged in/i.test(text)) {
    return { status: 'logged_out', detail: 'Codex is installed, but no account is signed in.' }
  }
  if (/logged in using chatgpt/i.test(text)) {
    return { status: 'logged_in', plan: 'ChatGPT', authMethod: 'chatgpt' }
  }
  if (/logged in using (?:an )?api key|logged in using amazon bedrock/i.test(text)) {
    return {
      status: 'api_key',
      detail: 'Codex is using an API key, not a ChatGPT sign-in, so calls would be billed to it.'
    }
  }
  if (/logged in using/i.test(text)) {
    return { status: 'logged_in', plan: null, authMethod: 'other' }
  }
  return { status: 'unknown', detail: 'CiteFox could not read the Codex sign-in status.' }
}

export type CodexFailureReason =
  | 'logged_out'
  | 'limit'
  | 'rate_limited'
  | 'overloaded'
  | 'model'
  | 'schema_rejected'
  | 'validation'
  | 'malformed'
  | 'error'

export type CodexParse =
  | { ok: true; text: string; json: unknown | null; usage: ClaudeCliUsage; webSearches: number }
  | {
      ok: false
      reason: CodexFailureReason
      detail: string
      usage: ClaudeCliUsage | null
      /** When a usage limit ends, if Codex said. Null otherwise. */
      resetsAt: Date | null
    }

interface CodexEvents {
  messages: string[]
  usage: ClaudeCliUsage | null
  completed: boolean
  failure: string | null
  errors: string[]
  webSearches: number
  sawEvent: boolean
}

function readEvents(stdout: string): CodexEvents {
  const events: CodexEvents = {
    messages: [],
    usage: null,
    completed: false,
    failure: null,
    errors: [],
    webSearches: 0,
    sawEvent: false
  }
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event: unknown
    try {
      event = JSON.parse(trimmed) as unknown
    } catch {
      continue
    }
    if (!isRecord(event) || typeof event.type !== 'string') continue
    events.sawEvent = true
    if (event.type === 'item.completed' && isRecord(event.item)) {
      const item = event.item
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        events.messages.push(item.text)
      } else if (item.type === 'web_search') {
        events.webSearches += 1
      }
    } else if (event.type === 'turn.completed') {
      events.completed = true
      events.usage = addUsage(events.usage, codexUsage(event.usage))
    } else if (event.type === 'turn.failed') {
      const error = isRecord(event.error) ? event.error : null
      events.failure = typeof error?.message === 'string' ? error.message : 'The Codex turn failed.'
    } else if (event.type === 'error' && typeof event.message === 'string') {
      events.errors.push(event.message)
    }
  }
  return events
}

function codexUsage(value: unknown): ClaudeCliUsage {
  const usage = emptyClaudeCliUsage()
  if (!isRecord(value)) return usage
  return {
    ...usage,
    inputTokens: numberOrNull(value.input_tokens),
    outputTokens: numberOrNull(value.output_tokens),
    cacheReadInputTokens: numberOrNull(value.cached_input_tokens),
    cacheCreationInputTokens: numberOrNull(value.cache_write_input_tokens)
  }
}

function addUsage(left: ClaudeCliUsage | null, right: ClaudeCliUsage): ClaudeCliUsage {
  if (left === null) return right
  const add = (a: number | null, b: number | null): number | null =>
    a === null ? b : b === null ? a : a + b
  return {
    ...left,
    inputTokens: add(left.inputTokens, right.inputTokens),
    outputTokens: add(left.outputTokens, right.outputTokens),
    cacheReadInputTokens: add(left.cacheReadInputTokens, right.cacheReadInputTokens),
    cacheCreationInputTokens: add(left.cacheCreationInputTokens, right.cacheCreationInputTokens)
  }
}

/** Codex does not name the model in its JSONL, so usage is filed under the requested one. */
export function withModelUsage(usage: ClaudeCliUsage, model: string): ClaudeCliUsage {
  return {
    ...usage,
    modelUsage: {
      [model]: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        costUsd: null
      }
    }
  }
}

/**
 * One `codex exec --json` run. The reply is the last `agent_message` (Codex may
 * send a short note before it). With a schema, that message is parsed as JSON,
 * nulls the strict schema forced on optional fields are dropped, and the value is
 * checked against the original schema.
 */
export function parseCodexExecOutput(
  stdout: string,
  stderr: string,
  schema: Record<string, unknown> | null,
  secrets: readonly string[],
  now: Date = new Date()
): CodexParse {
  const events = readEvents(stdout)
  const failureText =
    events.failure ?? (events.completed ? null : (lastRealError(events.errors) ?? null))
  if (failureText !== null || !events.completed) {
    // Codex's own error is the reason; stderr (its log lines) only when there is none.
    return classifyCodexFailure(failureText ?? stderr, secrets, {
      usage: events.usage,
      now,
      empty: !events.sawEvent && stderr.trim().length === 0
    })
  }
  const usage = events.usage ?? emptyClaudeCliUsage()
  const text = events.messages[events.messages.length - 1] ?? ''
  if (schema === null) {
    if (text.trim().length === 0) {
      return failure('malformed', 'Codex finished without a reply.', usage)
    }
    return { ok: true, text, json: null, usage, webSearches: events.webSearches }
  }
  const candidate = parseJsonReply(text)
  if (candidate === undefined) {
    return failure('validation', 'Codex did not reply with JSON.', usage)
  }
  const cleaned = stripOptionalNulls(candidate, schema)
  const problem = schemaError(cleaned, schema)
  if (problem !== null) {
    return failure('validation', redactString(problem, { secrets }), usage)
  }
  return {
    ok: true,
    text: JSON.stringify(cleaned),
    json: cleaned,
    usage,
    webSearches: events.webSearches
  }
}

function failure(
  reason: CodexFailureReason,
  detail: string,
  usage: ClaudeCliUsage | null,
  resetsAt: Date | null = null
): CodexParse {
  return { ok: false, reason, detail, usage, resetsAt }
}

/** The last top-level error that is not a reconnect notice. */
function lastRealError(errors: readonly string[]): string | undefined {
  return [...errors].reverse().find((message) => !/^reconnecting\b/i.test(message.trim()))
}

/** A JSON reply, also when the model wrapped it in a ```json fence. */
function parseJsonReply(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const body = fenced?.[1] ?? trimmed
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

const SCHEMA_REJECTED = /invalid_json_schema|invalid schema for response_format/i
const MODEL_PROBLEM =
  /model_not_found|model is not supported|not supported when using codex|unknown model|model .{0,80}does not exist/i
const USAGE_LIMIT =
  /usage limit|usage_limit_reached|hit your usage limit|quota exceeded|insufficient_quota|usage not included|purchase more credits|out of credits/i
const LOGGED_OUT =
  /not logged in|\b401\b|unauthori[sz]ed|missing bearer|codex login|refresh token|token (?:has )?expired|sign in again|log ?in again/i
const OVERLOADED = /overloaded|at capacity|server_overloaded|\b503\b|\b529\b/i
const RATE_LIMITED = /\b429\b|rate[ _-]?limit|too many requests/i

/** Plain-words reason for a failed run, from Codex's own error text. */
export function classifyCodexFailure(
  text: string,
  secrets: readonly string[],
  context: { usage: ClaudeCliUsage | null; now: Date; empty?: boolean }
): CodexParse {
  const detail = redactString(firstLine(readableError(text)).slice(0, 300), { secrets })
  const { usage } = context
  if (context.empty === true || text.trim().length === 0) {
    return failure('malformed', 'Codex returned an empty response.', usage)
  }
  if (SCHEMA_REJECTED.test(text)) return failure('schema_rejected', detail, usage)
  if (MODEL_PROBLEM.test(text)) return failure('model', detail, usage)
  if (USAGE_LIMIT.test(text)) {
    return failure('limit', detail, usage, codexResetsAt(text, context.now))
  }
  if (LOGGED_OUT.test(text)) return failure('logged_out', detail, usage)
  if (OVERLOADED.test(text)) return failure('overloaded', detail, usage)
  if (RATE_LIMITED.test(text)) return failure('rate_limited', detail, usage)
  return failure('error', detail || 'Codex stopped without a reason.', usage)
}

/** The `message` inside an API error body Codex passes on as a JSON string, else the text. */
function readableError(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(firstLine(trimmed)) as unknown
    if (isRecord(parsed)) {
      const inner = isRecord(parsed.error) ? parsed.error : parsed
      if (typeof inner.message === 'string') return inner.message
    }
  } catch {
    // Not one JSON body: use the text as it is.
  }
  return trimmed
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  )
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const UNIT_MS: Readonly<Record<string, number>> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000
}

/**
 * When a Codex usage limit ends. Codex words it as "… or try again at 3:45 PM."
 * (today, local time) or "… try again at Oct 30th, 2026 3:45 PM.", and the API body
 * can carry `resets_at` (epoch seconds) or `resets_in_seconds`. Null when none is given.
 */
export function codexResetsAt(text: string, now: Date): Date | null {
  const epoch = /resets_at\\?"?\s*[:=]\s*(\d{9,13})/i.exec(text)?.[1]
  if (epoch !== undefined) {
    const value = Number(epoch)
    return new Date(epoch.length > 10 ? value : value * 1000)
  }
  const inSeconds = /resets_in_seconds\\?"?\s*[:=]\s*(\d+)/i.exec(text)?.[1]
  if (inSeconds !== undefined) return new Date(now.getTime() + Number(inSeconds) * 1000)

  const relative = /try again in ((?:\d+\s*(?:seconds?|minutes?|hours?|days?)[\s,and]*)+)/i.exec(
    text
  )?.[1]
  if (relative !== undefined) {
    let total = 0
    for (const match of relative.matchAll(/(\d+)\s*(second|minute|hour|day)s?/gi)) {
      total += Number(match[1]) * (UNIT_MS[(match[2] ?? '').toLowerCase()] ?? 0)
    }
    if (total > 0) return new Date(now.getTime() + total)
  }

  const dated =
    /try again at ([a-z]{3})[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})?,? ?(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(
      text
    )
  if (dated !== null) {
    const month = MONTHS.indexOf((dated[1] ?? '').toLowerCase())
    if (month >= 0) {
      const year = dated[3] === undefined ? now.getFullYear() : Number(dated[3])
      const at = new Date(
        year,
        month,
        Number(dated[2]),
        hour24(Number(dated[4]), dated[6] ?? 'a'),
        Number(dated[5])
      )
      if (!Number.isNaN(at.getTime())) return at
    }
  }

  const clock = /try again at (\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(text)
  if (clock !== null) {
    const at = new Date(now)
    at.setHours(hour24(Number(clock[1]), clock[3] ?? 'a'), Number(clock[2]), 0, 0)
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
    return at
  }
  return null
}

function hour24(hour: number, meridiem: string): number {
  const pm = meridiem.toLowerCase() === 'p'
  if (hour === 12) return pm ? 12 : 0
  return pm ? hour + 12 : hour
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
