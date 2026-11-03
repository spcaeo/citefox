import { DEFAULT_CLAUDE_CONCURRENCY } from '@shared/domain'
import type { ConnectionState } from '@shared/domain'
import type { KeyTestReason } from '@shared/ipc'
import type { Logger } from '../../logging/logger'
import type { SecretStore } from '../../secrets/secret-store'
import { keyTestReasonForCode, ProviderError } from '../errors'
import { CITEFOX_USER_AGENT, requestWithRetry, type HttpTransport } from '../http'
import { isRecord, schemaError } from '../json-schema'
import { redactString } from '../../logging/redact'
import { logProvider, resolveSecretList } from '../log'
import { ClaudeCallError } from './call-error'
import {
  schemaAttemptLimit,
  type ClaudeCompletion,
  type ClaudeCompletionRequest,
  type ClaudeProvider
} from './claude-code'
import { accountProblem } from './limits'
import { DEFAULT_CLAUDE_MODEL } from './model'
import { emptyClaudeCliUsage, sumClaudeCliUsage, type ClaudeCliUsage } from './parse'
import { accountWords, transientWords } from './problems'
import { sharedClaudeGate } from './shared-gate'

/** Same id as {@link DEFAULT_CLAUDE_MODEL}. Kept for existing imports. */
export const DEFAULT_ANTHROPIC_MODEL = DEFAULT_CLAUDE_MODEL

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

const ANTHROPIC_VERSION = '2023-06-01'

/** One Messages call. An 8k-token structured reply can take minutes, not 60 s. */
export const ANTHROPIC_COMPLETION_TIMEOUT_MS = 180_000

/**
 * Transport attempts per Messages call. A 429, 529, or 5xx means the server
 * answered without a reply, so one more try is safe. A timeout is not
 * retried: the POST may have completed (and been billed) server-side.
 */
export const ANTHROPIC_TRANSPORT_ATTEMPTS = 2

const DEFAULT_MAX_TOKENS = 1024

export interface ProviderKeyTest {
  state: ConnectionState
  message: string
  nextStep: string | null
  /** Null when `state` is `ok`. */
  reason: KeyTestReason | null
}

export interface AnthropicApiProvider extends ClaudeProvider {
  readonly id: 'anthropic-api'
  testKey(): Promise<ProviderKeyTest>
}

export interface AnthropicApiProviderOptions {
  secretStore: SecretStore
  keychainRef: string
  transport: HttpTransport
  logger: Logger
  concurrency?: number
  model?: string | null
  sleep?: (ms: number) => Promise<void>
  clock?: () => number
  timeoutMs?: number
  secrets?: readonly string[] | (() => readonly string[])
}

/**
 * Section 5.1. The key is read from SecretStore and sent as `x-api-key`.
 * It is never written to disk, logs, or the child Claude process (section 5.3, NFR-5).
 */
export function createAnthropicApiProvider(
  options: AnthropicApiProviderOptions
): AnthropicApiProvider {
  const gate = sharedClaudeGate(options.concurrency ?? DEFAULT_CLAUDE_CONCURRENCY)
  const clock = options.clock ?? Date.now
  const timeoutMs = options.timeoutMs ?? ANTHROPIC_COMPLETION_TIMEOUT_MS

  const readSecret = (): string => {
    const secret = options.secretStore.get(options.keychainRef)
    if (secret === null) {
      throw new ProviderError('The Anthropic key is missing from the keychain.', {
        code: 'missing_secret',
        state: 'warning',
        nextStep: 'Add an Anthropic API key. CiteFox reads it from the keychain.'
      })
    }
    return secret
  }

  const completeOnce = async (
    request: ClaudeCompletionRequest,
    secret: string
  ): Promise<ClaudeCompletion> => {
    const secrets = resolveSecretList(options.secrets, [secret])
    const model = request.model ?? options.model ?? DEFAULT_CLAUDE_MODEL
    const response = await requestWithRetry(
      options.transport,
      {
        method: 'POST',
        url: ANTHROPIC_MESSAGES_URL,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'anthropic-version': ANTHROPIC_VERSION,
          'user-agent': CITEFOX_USER_AGENT,
          'x-api-key': secret
        },
        body: JSON.stringify(anthropicBody(request, model))
      },
      {
        timeoutMs,
        label: 'Anthropic messages',
        secrets,
        sleep: options.sleep,
        attempts: ANTHROPIC_TRANSPORT_ATTEMPTS,
        retryTimeouts: false
      }
    )
    logProvider(
      options.logger,
      response.status === 200 ? 'info' : 'warn',
      'anthropic messages finished',
      {
        endpoint: ANTHROPIC_MESSAGES_URL,
        status: response.status,
        snippet: response.body.slice(0, 200)
      },
      secrets
    )
    const interpreted = interpretAnthropic(response.status, response.body)
    if (!interpreted.ok) throw failureForAnthropic(interpreted, secrets)
    const usage = emptyClaudeCliUsage()
    usage.inputTokens = interpreted.inputTokens
    usage.outputTokens = interpreted.outputTokens
    if (interpreted.stopReason === 'max_tokens') {
      throw new ClaudeCallError(
        `The Anthropic reply was cut off at the ${request.maxTokens ?? DEFAULT_MAX_TOKENS}-token output limit (max_tokens), so it was not used.`,
        {
          code: 'malformed',
          state: 'warning',
          nextStep: 'Shorten the page text or the template, then try again.',
          secrets
        },
        usage,
        interpreted.model
      )
    }
    return {
      provider: 'anthropic-api',
      text: interpreted.text,
      json: interpreted.json,
      inputTokens: interpreted.inputTokens,
      outputTokens: interpreted.outputTokens,
      durationMs: 0,
      model: interpreted.model ?? model,
      resolvedModel: interpreted.model,
      usage
    }
  }

  const provider: AnthropicApiProvider = {
    id: 'anthropic-api',
    async complete(request: ClaudeCompletionRequest): Promise<ClaudeCompletion> {
      const secret = readSecret()
      const secrets = resolveSecretList(options.secrets, [secret])
      return gate(async () => {
        request.onStart?.()
        const started = clock()
        const answered: ClaudeCompletion[] = []
        try {
          let completion = await completeOnce(request, secret)
          answered.push(completion)
          if (request.schema) {
            let problem = schemaProblem(completion, request.schema)
            if (problem !== null && answered.length < schemaAttemptLimit(request)) {
              completion = await completeOnce(
                { ...request, prompt: schemaRetryPrompt(request.prompt, problem) },
                secret
              )
              answered.push(completion)
              problem = schemaProblem(completion, request.schema)
            }
            if (problem !== null) {
              throw new ProviderError(
                `Anthropic reply failed validation: ${redactString(problem, { secrets })}`,
                {
                  code: 'validation',
                  state: 'warning',
                  nextStep: 'Test the key again.',
                  secrets
                }
              )
            }
          }
          completion = {
            ...completion,
            ...summedUsage(answered),
            attempts: answered.length,
            durationMs: Math.max(0, clock() - started)
          }
          logProvider(
            options.logger,
            'info',
            'claude call finished',
            {
              provider: 'anthropic-api',
              durationMs: Math.max(0, clock() - started),
              outcome: 'ok',
              model: completion.model
            },
            secrets
          )
          return completion
        } catch (error) {
          const wrapped = withSpentUsage(
            error instanceof ProviderError
              ? error
              : new ProviderError(
                  error instanceof Error ? error.message : 'Anthropic request failed',
                  {
                    code: 'network',
                    state: 'warning',
                    nextStep: 'Test the key again.',
                    secrets
                  }
                ),
            answered
          )
          logProvider(
            options.logger,
            'warn',
            'claude call finished',
            {
              provider: 'anthropic-api',
              durationMs: Math.max(0, clock() - started),
              outcome: wrapped.code === 'plan_limit' ? 'limit' : 'error',
              code: wrapped.code,
              model: request.model ?? options.model ?? DEFAULT_CLAUDE_MODEL,
              inputTokens: spentUsage(wrapped)?.inputTokens ?? null,
              outputTokens: spentUsage(wrapped)?.outputTokens ?? null
            },
            secrets
          )
          throw wrapped
        }
      })
    },
    async testKey(): Promise<ProviderKeyTest> {
      try {
        await provider.complete({
          prompt: 'Reply with the single word ok.',
          maxTokens: 16,
          schema: null
        })
        return { state: 'ok', message: 'Key works.', nextStep: null, reason: null }
      } catch (error) {
        const secrets = resolveSecretList(options.secrets)
        const wrapped =
          error instanceof ProviderError
            ? error
            : new ProviderError(
                error instanceof Error ? error.message : 'Anthropic request failed',
                {
                  code: 'network',
                  state: 'warning',
                  nextStep: 'Test the key again.',
                  secrets
                }
              )
        return {
          state: wrapped.state === 'ok' ? 'warning' : wrapped.state,
          message: wrapped.message,
          nextStep: wrapped.nextStep,
          reason: keyTestReasonForCode(wrapped.code)
        }
      }
    }
  }

  return provider
}

interface AnthropicFailure {
  ok: false
  reason: 'unauthorized' | 'credit_low' | 'rate_limited' | 'overloaded' | 'malformed' | 'error'
  detail: string
}

function failureForAnthropic(failure: AnthropicFailure, secrets: readonly string[]): ProviderError {
  if (failure.reason === 'rate_limited' || failure.reason === 'overloaded') {
    const words = transientWords(failure.reason)
    return new ProviderError(words.message, {
      code: words.code,
      state: 'warning',
      nextStep: words.nextStep,
      secrets
    })
  }
  if (failure.reason === 'unauthorized' || failure.reason === 'credit_low') {
    const words = accountWords(failure.reason, 'anthropic-api')
    return new ProviderError(words.message, {
      code: words.code,
      state: 'warning',
      nextStep: words.nextStep,
      secrets
    })
  }
  return new ProviderError(failure.detail, {
    code: failure.reason === 'malformed' ? 'malformed' : 'network',
    state: 'warning',
    nextStep: 'Test the key again.',
    secrets
  })
}

export function interpretAnthropic(
  status: number,
  bodyText: string
):
  | {
      ok: true
      text: string
      json: unknown | null
      inputTokens: number | null
      outputTokens: number | null
      model: string | null
      /** `max_tokens` means the reply was cut off. */
      stopReason: string | null
    }
  | AnthropicFailure {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText) as unknown
  } catch {
    return statusFailure(status)
  }
  if (!isRecord(parsed)) return statusFailure(status)
  const error = isRecord(parsed.error) ? parsed.error : null
  const errorType = error && typeof error.type === 'string' ? error.type : null
  const errorMessage = error && typeof error.message === 'string' ? error.message : ''
  // "Your credit balance is too low to access the Anthropic API." comes back as a 400.
  if (status !== 200 && accountProblem(errorMessage) === 'credit_low') {
    return {
      ok: false,
      reason: 'credit_low',
      detail: 'This Anthropic API key has run out of credit.'
    }
  }
  if (status === 401 || status === 403 || errorType === 'authentication_error') {
    return { ok: false, reason: 'unauthorized', detail: 'Anthropic rejected this key.' }
  }
  if (status === 529 || errorType === 'overloaded_error') {
    return { ok: false, reason: 'overloaded', detail: 'Anthropic is overloaded.' }
  }
  if (status === 429 || errorType === 'rate_limit_error') {
    return { ok: false, reason: 'rate_limited', detail: 'Anthropic hit a rate limit.' }
  }
  if (status !== 200) return statusFailure(status)
  const text = anthropicText(parsed.content)
  if (text === null) {
    return {
      ok: false,
      reason: 'malformed',
      detail: 'Anthropic returned a response CiteFox could not read.'
    }
  }
  const usage = isRecord(parsed.usage) ? parsed.usage : null
  const model = typeof parsed.model === 'string' ? parsed.model : null
  return {
    ok: true,
    text,
    json: parseJsonOrNull(text),
    inputTokens: numberOrNull(usage?.input_tokens),
    outputTokens: numberOrNull(usage?.output_tokens),
    model,
    stopReason: typeof parsed.stop_reason === 'string' ? parsed.stop_reason : null
  }
}

function statusFailure(status: number): AnthropicFailure {
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'unauthorized', detail: 'Anthropic rejected this key.' }
  }
  if (status === 529) return { ok: false, reason: 'overloaded', detail: 'Anthropic is overloaded.' }
  if (status === 429)
    return { ok: false, reason: 'rate_limited', detail: 'Anthropic hit a rate limit.' }
  return {
    ok: false,
    reason: 'error',
    detail: 'Anthropic returned a response CiteFox could not read.'
  }
}

function anthropicBody(request: ClaudeCompletionRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: request.prompt }]
  }
  if (request.schema) {
    body.output_config = { format: { type: 'json_schema', schema: request.schema } }
  }
  if (request.webSearch === true) {
    // Batch 2 row 5: Anthropic's server-side web search for this one call. It runs on
    // Anthropic's side; nothing runs on this computer. The reply is still checked as JSON.
    body.tools = [{ ...ANTHROPIC_WEB_SEARCH_TOOL }]
  }
  return body
}

/** https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool */
export const ANTHROPIC_WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5
} as const

/** Usage fields for a completion built from several attempts. */
function summedUsage(
  attempts: readonly ClaudeCompletion[]
): Pick<ClaudeCompletion, 'usage' | 'inputTokens' | 'outputTokens'> {
  const usage = sumClaudeCliUsage(attempts.map((attempt) => attempt.usage))
  return { usage, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
}

function schemaProblem(
  completion: ClaudeCompletion,
  schema: Record<string, unknown>
): string | null {
  return completion.json === null ? 'The reply was not JSON.' : schemaError(completion.json, schema)
}

function schemaRetryPrompt(prompt: string, problem: string): string {
  return `${prompt}\n\nThe previous reply failed validation: ${problem}. Reply with JSON that matches the schema.`
}

/**
 * A failure after one or more replies keeps their tokens: the error becomes a
 * `ClaudeCallError` whose usage adds every answered attempt to any usage the
 * error already carried (a reply cut off at max_tokens). Code and next step stay.
 */
function withSpentUsage(
  error: ProviderError,
  answered: readonly ClaudeCompletion[]
): ProviderError {
  if (answered.length === 0) return error
  const carried = error instanceof ClaudeCallError ? error.usage : null
  const usage = sumClaudeCliUsage([...answered.map((attempt) => attempt.usage), carried])
  const resolvedModel =
    (error instanceof ClaudeCallError ? error.resolvedModel : null) ??
    answered[answered.length - 1]?.resolvedModel ??
    null
  return new ClaudeCallError(
    error.message,
    { code: error.code, state: error.state, nextStep: error.nextStep, limit: error.limit },
    usage,
    resolvedModel
  )
}

function spentUsage(error: ProviderError): ClaudeCliUsage | null {
  return error instanceof ClaudeCallError ? error.usage : null
}

function anthropicText(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue
    parts.push(block.text)
  }
  if (parts.length === 0) return null
  return parts.join('')
}

function parseJsonOrNull(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
