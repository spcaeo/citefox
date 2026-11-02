import type { GenerationTemplateKind } from '@shared/domain'
import type { ModelUsage } from '@shared/ipc'
import { randomUUID } from 'node:crypto'
import { progressNote, progressRetryNext, progressStep } from '../assist/progress'
import type { Logger } from '../logging/logger'
import { redactString, redactValue } from '../logging/redact'
import { ClaudeCallError } from '../providers/claude/call-error'
import {
  CLAUDE_SCHEMA_ATTEMPTS,
  type ClaudeCompletion,
  type ClaudeProvider
} from '../providers/claude/claude-code'
import type { ClaudeCliUsage } from '../providers/claude/parse'
import { ProviderError } from '../providers/errors'
import {
  getCachedGeneration,
  insertGeneration,
  listGenerations,
  STORED_GENERATION_KINDS,
  type StoredGenerationKind
} from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { PipelineError, type PipelineErrorCode, type ValidationProblem } from './errors'
import { generationCacheKey } from './hash'

/**
 * LLM-4. Retries are split by layer. The provider owns transport retries and the
 * schema retry (`schemaAttempts`). This pipeline owns the domain check
 * (`validate`) and retries a miss once, then fails with a typed error.
 */
export const DOMAIN_RETRY_LIMIT = 1

/**
 * Most model requests one generation may make across both layers, the
 * provider's schema retry included. Transport retries of a reply-less
 * 429, 529, or 5xx are not model requests and are not counted.
 */
export const MODEL_REQUESTS_PER_GENERATION = 3

/**
 * Daily and monthly Claude call caps shared by every generation, including
 * check reports. Null means that window is not capped.
 */
export interface GenerationCallCaps {
  daily: number | null
  monthly: number | null
}

/** The caps every `completeStructured` caller uses unless a test sets them. */
export function generationCallCaps(): GenerationCallCaps {
  return { daily: null, monthly: null }
}

/**
 * Generation kinds, including check-report calls. `video_brief` (FR-18.4) is
 * not a stored generation row: the brief is kept on its video idea.
 */
export type StructuredGenerationKind = GenerationTemplateKind | 'summary' | 'video_brief'

export interface StructuredResult {
  value: unknown
  fromCache: boolean
  usage: ModelUsage
  /** Null when the row could not be saved. A cache hit returns the stored id. */
  generationId: string | null
}

/** Counts from `ClaudeCompletion.usage`. Cost is not copied. A null count is stored as 0. */
export function modelUsageFromCompletion(completion: ClaudeCompletion): ModelUsage {
  return modelUsageFromCli(completion.usage)
}

export function modelUsageFromCli(usage: ClaudeCliUsage): ModelUsage {
  return {
    inputTokens: nonNegative(usage.inputTokens),
    outputTokens: nonNegative(usage.outputTokens),
    cacheReadTokens: nonNegative(usage.cacheReadInputTokens),
    cacheCreationTokens: nonNegative(usage.cacheCreationInputTokens),
    serpapiSearches: 0
  }
}

/**
 * Rendered prompt in, validated JSON out. A cached output for the same input hash,
 * model, and connection skips the provider. A domain miss is retried once within
 * `MODEL_REQUESTS_PER_GENERATION`, unless the call caps are reached. Usage comes
 * from `completion.usage`, or from a `ClaudeCallError` when a call fails after the
 * model answered, so a failed attempt still records its tokens.
 */
export async function completeStructured(options: {
  db: SqliteDatabase
  pageId: string
  provider: ClaudeProvider
  logger: Logger
  kind: StructuredGenerationKind
  templateId: string
  templateHash: string
  prompt: string
  schema: Record<string, unknown>
  model?: string | null
  inputHash: string
  validate: (value: unknown) => ValidationProblem | null
  secrets?: readonly string[]
  now?: () => string
  force?: boolean
  caps?: GenerationCallCaps
  /** Who is calling, for `llm_calls` (FR-25.6). The template columns are filled from this call. */
  trace?: { source: 'pipeline' | 'report'; projectId: string | null }
  /**
   * Allows web search and web fetch for this one call (Docs/PROMPT-AUDIT.md section 3
   * rule 8): only where the answer is not in saved data, with short derived lines in the
   * prompt and never raw page text. Off by default.
   */
  webSearch?: boolean
}): Promise<StructuredResult> {
  const secrets = options.secrets ?? []
  const now = options.now ?? (() => new Date().toISOString())
  const keyed = {
    ...options,
    inputHash: generationCacheKey({
      inputHash: options.inputHash,
      model: options.model ?? null,
      connection: options.provider.id
    })
  }
  assertWithinCallCaps(options, now())
  if (!options.force && isStoredKind(options.kind)) {
    const cached = getCachedGeneration(options.db, options.kind, keyed.inputHash)
    if (cached !== null && options.validate(cached.output) === null) {
      log(
        options.logger,
        'info',
        'claude call reused',
        { kind: options.kind, outcome: 'cache' },
        secrets
      )
      progressNote({
        kind: 'cache',
        label: 'Reused the saved answer',
        detail: 'Same inputs as last time · no new call'
      })
      return { value: cached.output, fromCache: true, usage: cached.usage, generationId: cached.id }
    }
  }

  let prompt = options.prompt
  let last: ValidationProblem = {
    code: 'schema_validation',
    message: 'The reply did not match the schema.'
  }
  let requestsLeft = MODEL_REQUESTS_PER_GENERATION
  for (let attempt = 0; attempt <= DOMAIN_RETRY_LIMIT && requestsLeft > 0; attempt += 1) {
    if (attempt > 0) assertWithinCallCaps(options, now())
    const startedAt = now()
    const schemaAttempts = Math.min(CLAUDE_SCHEMA_ATTEMPTS, requestsLeft)
    let completion: ClaudeCompletion
    try {
      completion = await options.provider.complete({
        prompt,
        schema: options.schema,
        model: options.model ?? null,
        maxTokens: 8000,
        schemaAttempts,
        // Opt-in per call, as in `completeAssist`: the flag is sent only when it is on.
        ...(options.webSearch === true ? { webSearch: true } : {}),
        trace: {
          source: options.trace?.source ?? 'pipeline',
          projectId: options.trace?.projectId ?? null,
          templateKind: templateKindOf(options.kind),
          templateId: options.templateId,
          templateHash: options.templateHash,
          assistId: null
        }
      })
    } catch (error) {
      const wrapped = asProviderError(error, secrets)
      const spent = error instanceof ClaudeCallError ? error : null
      record(keyed, {
        startedAt,
        completion: null,
        resolvedModel: spent?.resolvedModel ?? null,
        ok: false,
        error: wrapped.message,
        output: null,
        usage: spent?.usage ? modelUsageFromCli(spent.usage) : zeroUsage()
      })
      throw new PipelineError(wrapped.message, {
        code: wrapped.code === 'validation' ? 'schema_validation' : 'fetch_failed',
        nextStep: wrapped.nextStep ?? 'Try again.',
        secrets
      })
    }
    requestsLeft -= requestsUsed(completion, schemaAttempts)
    const usage = modelUsageFromCompletion(completion)
    const check = progressStep({ kind: 'check', label: 'Checking the answer' })
    const problem = options.validate(completion.json)
    if (problem === null) {
      check.done()
      const generationId = record(keyed, {
        startedAt,
        completion,
        resolvedModel: null,
        ok: true,
        error: null,
        output: completion.json,
        usage
      })
      return { value: completion.json, fromCache: false, usage, generationId }
    }
    last = { code: problem.code, message: redactString(problem.message, { secrets }) }
    const again = attempt < DOMAIN_RETRY_LIMIT && requestsLeft > 0
    check.fail(again ? `${last.message} · asking again` : last.message)
    if (again) progressRetryNext()
    record(keyed, {
      startedAt,
      completion,
      resolvedModel: null,
      ok: false,
      error: last.message,
      output: null,
      usage
    })
    prompt = `${options.prompt}\n\nThe previous reply failed validation: ${last.message}. Reply with JSON that matches the schema.`
  }
  throw validationError(last, secrets)
}

function record(
  options: {
    db: SqliteDatabase
    pageId: string
    provider: ClaudeProvider
    logger: Logger
    kind: StructuredGenerationKind
    templateId: string
    templateHash: string
    model?: string | null
    inputHash: string
    secrets?: readonly string[]
  },
  call: {
    startedAt: string
    completion: ClaudeCompletion | null
    /** Model a failed call reported when there is no completion. */
    resolvedModel: string | null
    ok: boolean
    error: string | null
    output: unknown
    usage: ModelUsage
  }
): string | null {
  if (!isStoredKind(options.kind)) return null
  const secrets = options.secrets ?? []
  const id = `gen-${randomUUID()}`
  try {
    insertGeneration(
      options.db,
      {
        id,
        pageId: options.pageId,
        kind: options.kind,
        templateId: options.templateId,
        templateHash: options.templateHash,
        startedAt: call.startedAt,
        durationMs: call.completion?.durationMs ?? 0,
        model:
          call.completion?.resolvedModel ??
          call.completion?.model ??
          call.resolvedModel ??
          options.model ??
          null,
        connection: call.completion?.provider ?? options.provider.id,
        ok: call.ok,
        error: call.error === null ? null : redactString(call.error, { secrets }),
        inputHash: options.inputHash,
        usage: call.usage
      },
      call.ok ? redactValue(call.output, { secrets, hexKeys: false }) : null
    )
    return id
  } catch (error) {
    log(
      options.logger,
      'error',
      'could not record generation',
      { message: error instanceof Error ? error.message : 'save failed' },
      secrets
    )
    return null
  }
}

function assertWithinCallCaps(
  options: { db: SqliteDatabase; pageId: string; caps?: GenerationCallCaps },
  now: string
): void {
  const caps = options.caps ?? generationCallCaps()
  if (caps.daily === null && caps.monthly === null) return
  const day = now.slice(0, 10)
  const month = now.slice(0, 7)
  let dailyCount = 0
  let monthlyCount = 0
  if (caps.daily !== 0 && caps.monthly !== 0) {
    for (const row of listGenerations(options.db, options.pageId)) {
      if (row.startedAt.slice(0, 10) === day) dailyCount += 1
      if (row.startedAt.slice(0, 7) === month) monthlyCount += 1
    }
  }
  if (caps.daily !== null && dailyCount >= caps.daily) {
    throw new PipelineError(
      'The daily CiteFox AI cap is reached, so this generation was not run.',
      {
        code: 'fetch_failed',
        nextStep: 'Wait until tomorrow, or raise the daily cap.'
      }
    )
  }
  if (caps.monthly !== null && monthlyCount >= caps.monthly) {
    throw new PipelineError(
      'The monthly CiteFox AI cap is reached, so this generation was not run.',
      {
        code: 'fetch_failed',
        nextStep: 'Wait until next month, or raise the monthly cap.'
      }
    )
  }
}

/** The template kind a stored generation kind came from (`summary` is `run_summary`). */
export function templateKindOf(kind: StructuredGenerationKind): string {
  return kind === 'summary' ? 'run_summary' : kind
}

/** A provider that does not report `attempts` used one request. Never more than it was allowed. */
function requestsUsed(completion: ClaudeCompletion, allowed: number): number {
  const reported = completion.attempts
  if (reported === undefined || !Number.isInteger(reported) || reported < 1) return 1
  return Math.min(reported, allowed)
}

function isStoredKind(kind: StructuredGenerationKind): kind is StoredGenerationKind {
  return (STORED_GENERATION_KINDS as readonly string[]).includes(kind)
}

function validationError(problem: ValidationProblem, secrets: readonly string[]): PipelineError {
  const nextStep =
    problem.code === 'brand_in_prompt'
      ? 'Remove the brand name from the prompt and try again.'
      : problem.code === 'quote_not_on_page'
        ? 'Quote only headings that are on the page, then try again.'
        : 'Try again. If it still fails, edit the template.'
  return new PipelineError(problem.message, { code: problem.code, nextStep, secrets })
}

function asProviderError(error: unknown, secrets: readonly string[]): ProviderError {
  if (error instanceof ProviderError) return error
  const message = error instanceof Error ? error.message : 'The CiteFox AI call failed'
  return new ProviderError(message, {
    code: 'network',
    state: 'warning',
    nextStep: 'Try again.',
    secrets
  })
}

function zeroUsage(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    serpapiSearches: 0
  }
}

function nonNegative(value: number | null): number {
  if (value === null || !Number.isInteger(value) || value < 0) return 0
  return value
}

function log(
  logger: Logger,
  level: 'info' | 'warn' | 'error',
  message: string,
  extra: unknown,
  secrets: readonly string[]
): void {
  logger[level](redactString(message, { secrets }), redactValue(extra, { secrets }))
}

export function isPipelineCode(code: string): code is PipelineErrorCode {
  return (
    code === 'schema_validation' ||
    code === 'brand_in_prompt' ||
    code === 'quote_not_on_page' ||
    code === 'fetch_failed' ||
    code === 'template' ||
    code === 'not_found'
  )
}
