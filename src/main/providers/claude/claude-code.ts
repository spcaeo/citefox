import { DEFAULT_CLAUDE_CONCURRENCY } from '@shared/domain'
import { homedir } from 'node:os'
import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import type { CommandRequest, CommandResult, CommandTransport, RetryBudget } from '../command'
import { runCommandWithRetry } from '../command'
import { ProviderError, ProviderTimeoutError } from '../errors'
import { logProvider, resolveSecretList } from '../log'
import type { BinaryProbe, LocatedBinary } from './binary'
import { ClaudeCallError } from './call-error'
import { locateClaudeBinary } from './binary'
import {
  CLAUDE_CODE_MIN_VERSION,
  assertNoAccountSwitch,
  claudePrintArgs,
  isRequiredRestrictionFlag,
  rejectedRestrictionFlag,
  type OptionalRestrictionFlag,
  type RestrictionFlag
} from './claude-args'
import { scrubClaudeEnv } from './env'
import { classifyClaudeFailure, type ClaudeLimitInfo } from './limits'
import { accountWords, limitWords, transientWords } from './problems'
import {
  claudeCodePause,
  clearClaudeCodePause,
  pauseClaudeCode,
  sharedClaudeGate
} from './shared-gate'
import { DEFAULT_CLAUDE_MODEL } from './model'
import type { ClaudeCliUsage, CliParse, LoginProbe } from './parse'
import {
  parseAuthStatus,
  parseClaudeCliOutput,
  parseClaudeVersion,
  resolvedModelId,
  sumClaudeCliUsage
} from './parse'

export { CLAUDE_CODE_MIN_VERSION, EMPTY_MCP_CONFIG, claudePrintArgs } from './claude-args'

/**
 * Who made a Claude call, for the `llm_calls` log (FR-25.6). Providers ignore it.
 * Never holds the prompt or a secret.
 */
export interface LlmCallTrace {
  source: 'pipeline' | 'report' | 'assist' | 'playground' | 'ask' | 'other'
  /** Null for a call outside any project. */
  projectId: string | null
  templateKind: string | null
  templateId: string | null
  templateHash: string | null
  assistId: string | null
}

export interface ClaudeCompletionRequest {
  prompt: string
  /** Read by the call log (`withCallLog`). Providers do not use it. */
  trace?: LlmCallTrace
  schema?: Record<string, unknown> | null
  model?: string | null
  maxTokens?: number
  /**
   * Model requests this call may make for the schema: 1 sends no schema retry,
   * 2 (the default) allows one. The caller uses it to keep a whole generation
   * within its request budget. Transport retries are separate.
   */
  schemaAttempts?: number
  /**
   * Batch 2 row 5: allow only web search and web fetch for this one call (competitors
   * per product). Claude Code gets `--tools "WebSearch,WebFetch"` (see `claudePrintArgs`);
   * the Anthropic API gets its server-side web search tool. Off by default.
   */
  webSearch?: boolean
  /**
   * The live progress step for this call (`assist:progress`), when the purpose label is
   * not enough, such as one search per product. Providers ignore it.
   */
  progress?: { label?: string; detail?: string }
  /**
   * Called when the call really starts, after waiting its turn at the concurrency gate
   * (LLM-7), so a screen can tell "waiting" from "working". Once per `complete`.
   */
  onStart?: () => void
}

/** Default and largest `schemaAttempts`: the first reply and one schema retry. */
export const CLAUDE_SCHEMA_ATTEMPTS = 2

/** `request.schemaAttempts` clamped to 1 or 2. */
export function schemaAttemptLimit(request: ClaudeCompletionRequest): number {
  const asked = request.schemaAttempts
  if (asked === undefined || !Number.isInteger(asked)) return CLAUDE_SCHEMA_ATTEMPTS
  return Math.min(CLAUDE_SCHEMA_ATTEMPTS, Math.max(1, asked))
}

export interface ClaudeCompletion {
  provider: 'claude-code' | 'anthropic-api' | 'codex'
  text: string
  json: unknown | null
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number
  /** Model id passed to the provider. Never null for Claude Code after resolution. */
  model: string | null
  /**
   * Claude Code: model id from `modelUsage` (most output tokens).
   * Null when that map is absent. Anthropic: the response `model`, or null.
   */
  resolvedModel: string | null
  /** Token counts for this call. Claude Code has no `key_usage` row to store them. */
  usage: ClaudeCliUsage
  /** Model requests behind this completion, a schema retry included. Absent means 1. */
  attempts?: number
}

export interface ClaudeProvider {
  readonly id: 'claude-code' | 'anthropic-api' | 'codex'
  complete(request: ClaudeCompletionRequest): Promise<ClaudeCompletion>
}

export interface ClaudeCodeTimeouts {
  versionMs: number
  loginMs: number
  completeMs: number
}

export interface ClaudeCodeProviderOptions {
  command: CommandTransport
  probe: BinaryProbe
  logger: Logger
  /** LLM-7. Selects the process-wide gate for this limit (see `sharedClaudeGate`). */
  concurrency?: number
  /** Saved Settings path. Null searches PATH and the usual folders (LLM-1). */
  savedBinaryPath?: string | null
  model?: string | null
  home?: string
  platform?: NodeJS.Platform
  pathEnv?: string
  baseEnv?: NodeJS.ProcessEnv
  sleep?: (ms: number) => Promise<void>
  clock?: () => number
  secrets?: readonly string[] | (() => readonly string[])
  timeouts?: Partial<ClaudeCodeTimeouts>
  /**
   * The checkup's test call runs even while Claude Code is paused after a limit
   * (`claudeCodePause`), so "Check again" can find out that the limit has reset.
   */
  ignorePause?: boolean
}

export interface ClaudeCodeProvider extends ClaudeProvider {
  readonly id: 'claude-code'
  locate(preferred: string | null): LocatedBinary
  readVersion(
    binaryPath: string
  ): Promise<
    | { ok: true; version: string }
    | { ok: false; reason: 'not_installed' | 'timeout' | 'unreadable' }
  >
  readLogin(
    binaryPath: string
  ): Promise<LoginProbe | { status: 'timeout' } | { status: 'not_installed' }>
  completeAt(binaryPath: string, request: ClaudeCompletionRequest): Promise<ClaudeCompletion>
}

/**
 * One `claude -p` call. An 8k-token structured reply on a long page can take
 * well over a minute, so the old 60 s limit cut off good replies.
 */
export const CLAUDE_CODE_COMPLETION_TIMEOUT_MS = 180_000

/**
 * A web-search call (batch 2 row 5): several searches, then the reply. Live runs on
 * textbolt.com took 90–130 s and one hit 150 s, so it gets the full 180 s, and a timed-out
 * search is not started again.
 */
export const CLAUDE_CODE_WEB_SEARCH_TIMEOUT_MS = 180_000

/**
 * Attempt budget for one completion: the first call, at most one transport
 * retry (timeout or spawn failure), and at most one schema retry. The two
 * retries share the budget, so a completion starts `claude` at most three
 * times (a CLI that rejects a cosmetic flag fails fast and is not counted).
 */
export const CLAUDE_CODE_TRANSPORT_RETRIES = 1

const DEFAULT_TIMEOUTS: ClaudeCodeTimeouts = {
  versionMs: 10_000,
  loginMs: 15_000,
  completeMs: CLAUDE_CODE_COMPLETION_TIMEOUT_MS
}

/**
 * Optional restriction flags this process has seen rejected. Shared by every
 * provider instance so a rejected argv is not tried again. Required
 * (tool-disabling) flags are never added here: their rejection is an error.
 */
const rejectedOptionalFlags = new Set<OptionalRestrictionFlag>()

/** Test-only. Production keeps the decision until the process exits. */
export function resetClaudeCodeFlagSupportForTests(): void {
  rejectedOptionalFlags.clear()
}

/** Null or empty Settings / request model becomes {@link DEFAULT_CLAUDE_MODEL}. */
export function resolveClaudeModel(
  requestModel: string | null | undefined,
  settingsModel: string | null | undefined
): string {
  const chosen = requestModel ?? settingsModel ?? null
  if (chosen !== null && chosen.length > 0) return chosen
  return DEFAULT_CLAUDE_MODEL
}

export function createClaudeCodeProvider(options: ClaudeCodeProviderOptions): ClaudeCodeProvider {
  const gate = sharedClaudeGate(options.concurrency ?? DEFAULT_CLAUDE_CONCURRENCY)
  const clock = options.clock ?? Date.now
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts }
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform

  const secretsNow = (extra: readonly string[] = []): string[] =>
    resolveSecretList(options.secrets, extra)

  const run = async (
    binaryPath: string,
    args: readonly string[],
    stdin: string | null,
    timeoutMs: number,
    budget?: RetryBudget
  ): Promise<CommandResult> => {
    assertNoAccountSwitch(args)
    const secrets = secretsNow()
    const request: Omit<CommandRequest, 'signal'> = {
      command: binaryPath,
      args,
      stdin,
      env: scrubClaudeEnv(options.baseEnv ?? process.env),
      timeoutMs
    }
    const result = await runCommandWithRetry(options.command, request, {
      sleep: options.sleep,
      secrets,
      shouldRetry: (candidate) => retryClaudeCommand(candidate),
      ...(budget === undefined ? {} : { budget })
    })
    logProvider(
      options.logger,
      result.timedOut || result.spawnError !== null || result.exitCode !== 0 ? 'warn' : 'info',
      'claude command finished',
      {
        args,
        stdinChars: stdin?.length ?? 0,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        spawnError: result.spawnError,
        stderr: result.stderr.slice(0, 500)
      },
      secrets
    )
    return result
  }

  const provider: ClaudeCodeProvider = {
    id: 'claude-code',
    locate(preferred: string | null): LocatedBinary {
      return locateClaudeBinary(preferred, options.probe, {
        home,
        platform,
        pathEnv: options.pathEnv === undefined ? process.env.PATH : options.pathEnv
      })
    },
    async readVersion(binaryPath: string) {
      const result = await run(binaryPath, ['--version'], '', timeouts.versionMs)
      if (result.spawnError === 'ENOENT') return { ok: false, reason: 'not_installed' }
      if (result.timedOut) return { ok: false, reason: 'timeout' }
      const version = parseClaudeVersion(result.stdout)
      if (version === null) return { ok: false, reason: 'unreadable' }
      return { ok: true, version }
    },
    async readLogin(binaryPath: string) {
      const result = await run(binaryPath, ['auth', 'status', '--json'], '', timeouts.loginMs)
      if (result.spawnError === 'ENOENT') return { status: 'not_installed' }
      if (result.timedOut) return { status: 'timeout' }
      return parseAuthStatus(result.stdout, result.stderr)
    },
    async complete(request: ClaudeCompletionRequest): Promise<ClaudeCompletion> {
      const preferred = options.savedBinaryPath ?? null
      const located = provider.locate(preferred)
      if (located.path === null) {
        throw new ProviderError('Claude Code was not found.', {
          code: 'not_installed',
          state: 'warning',
          nextStep: 'Install Claude Code, or set the path in Settings, then try again.',
          secrets: secretsNow()
        })
      }
      return provider.completeAt(located.path, request)
    },
    async completeAt(
      binaryPath: string,
      request: ClaudeCompletionRequest
    ): Promise<ClaudeCompletion> {
      // A limit already hit: fail at once, without queueing or starting `claude`.
      throwIfPaused(binaryPath)
      return gate(async () => {
        // Calls queued behind the one that hit the limit stop here too.
        throwIfPaused(binaryPath)
        request.onStart?.()
        const started = clock()
        const secrets = secretsNow()
        const model = resolveClaudeModel(request.model, options.model)
        const schema = request.schema ?? null
        const web = request.webSearch === true
        // A timed-out web search is not started again: it already took minutes.
        const budget: RetryBudget = { retriesLeft: web ? 0 : CLAUDE_CODE_TRANSPORT_RETRIES }
        const call: PrintCall = {
          model,
          schema,
          webSearch: web,
          timeoutMs: web
            ? Math.min(timeouts.completeMs, CLAUDE_CODE_WEB_SEARCH_TIMEOUT_MS)
            : timeouts.completeMs
        }
        const usages: (ClaudeCliUsage | null)[] = []
        try {
          let parsed = await execute(binaryPath, request.prompt, call, secrets, budget)
          usages.push(parsed.usage)
          if (!parsed.ok && parsed.reason === 'validation' && schemaAttemptLimit(request) > 1) {
            const prompt = `${request.prompt}\n\nThe previous reply failed validation: ${parsed.detail}. Reply with JSON that matches the schema.`
            parsed = await execute(binaryPath, prompt, call, secrets, budget)
            usages.push(parsed.usage)
          }
          const usage = sumClaudeCliUsage(usages)
          if (!parsed.ok) throw failureFor(parsed, usage, secrets, new Date(clock()))
          const durationMs = Math.max(0, clock() - started)
          const resolvedModel = resolvedModelId(usage.modelUsage, model)
          const completion: ClaudeCompletion = {
            provider: 'claude-code',
            text: parsed.text,
            json: parsed.json,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            durationMs,
            model,
            resolvedModel,
            usage,
            attempts: usages.length
          }
          logCall(durationMs, 'ok', resolvedModel ?? model, usage, secrets)
          // Claude answered, so any limit this program hit has lifted.
          if (claudeCodePause(binaryPath, clock()) !== null) clearClaudeCodePause()
          return completion
        } catch (error) {
          const durationMs = Math.max(0, clock() - started)
          const wrapped =
            error instanceof ProviderError
              ? error
              : new ProviderError(error instanceof Error ? error.message : 'Claude Code failed', {
                  code: 'spawn',
                  state: 'warning',
                  nextStep: 'Check again.',
                  secrets
                })
          const usage =
            wrapped instanceof ClaudeCodeCallError
              ? wrapped.usage
              : usages.length > 0
                ? sumClaudeCliUsage(usages)
                : null
          const resolvedModel =
            wrapped instanceof ClaudeCodeCallError ? wrapped.resolvedModel : null
          if (wrapped.code === 'plan_limit' && wrapped.limit !== null) {
            const paused = pauseClaudeCode(binaryPath, wrapped.limit, clock())
            logProvider(
              options.logger,
              'warn',
              'claude code paused until its limit resets',
              {
                kind: paused.limit.kind,
                resetsAt: paused.limit.resetsAt?.toISOString() ?? null,
                until: new Date(paused.until).toISOString()
              },
              secrets
            )
          }
          logCall(
            durationMs,
            wrapped.code === 'plan_limit' ? 'limit' : 'error',
            resolvedModel ?? model,
            usage,
            secrets
          )
          throw wrapped
        }
      })
    }
  }

  function throwIfPaused(binaryPath: string): void {
    if (options.ignorePause === true) return
    const paused = claudeCodePause(binaryPath, clock())
    if (paused === null) return
    const words = limitWords(paused.limit, new Date(clock()))
    throw new ClaudeCodeCallError(
      words.message,
      {
        code: 'plan_limit',
        state: 'warning',
        nextStep: words.nextStep,
        secrets: secretsNow(),
        limit: paused.limit
      },
      null
    )
  }

  /**
   * One print call. A rejected optional flag is dropped (only that flag) and
   * the call is repeated. A rejected tool-disabling flag is an error: CiteFox
   * never sends page text to a CLI that has tools on.
   */
  async function execute(
    binaryPath: string,
    prompt: string,
    call: PrintCall,
    secrets: readonly string[],
    budget: RetryBudget
  ): Promise<CliParse> {
    const { schema } = call
    for (;;) {
      const result = await run(
        binaryPath,
        claudePrintArgs(call.model, schema, rejectedOptionalFlags, { webSearch: call.webSearch }),
        prompt,
        call.timeoutMs,
        budget
      )
      const rejected = rejectedRestrictionFlag(result)
      if (rejected === null) return finishPrint(result, call, secrets)
      if (isRequiredRestrictionFlag(rejected)) throw toolRestrictionUnsupported(rejected, secrets)
      if (rejectedOptionalFlags.has(rejected)) return finishPrint(result, call, secrets)
      rejectedOptionalFlags.add(rejected)
      logProvider(
        options.logger,
        'warn',
        `Claude Code rejected ${rejected}; retrying without that flag`,
        { flag: rejected },
        secrets
      )
    }
  }

  function finishPrint(
    result: CommandResult,
    call: PrintCall,
    secrets: readonly string[]
  ): CliParse {
    const { schema } = call
    if (result.spawnError === 'ENOENT') {
      throw new ProviderError('Claude Code is not installed.', {
        code: 'not_installed',
        state: 'warning',
        nextStep: 'Install Claude Code, or set the path in Settings, then try again.',
        secrets
      })
    }
    if (result.timedOut) throw new ProviderTimeoutError('Claude Code', call.timeoutMs, secrets)
    const parsed = parseClaudeCliOutput(
      result.stdout,
      result.stderr,
      schema,
      secrets,
      new Date(clock())
    )
    if (!parsed.ok && (parsed.reason === 'error' || parsed.reason === 'malformed')) {
      return { ...parsed, detail: commandFailureDetail(result, secrets) }
    }
    return parsed
  }

  function logCall(
    durationMs: number,
    outcome: 'ok' | 'limit' | 'error',
    model: string,
    usage: ClaudeCliUsage | null,
    secrets: readonly string[]
  ): void {
    logProvider(
      options.logger,
      outcome === 'ok' ? 'info' : 'warn',
      'claude call finished',
      {
        provider: 'claude-code',
        durationMs,
        outcome,
        model,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
        cacheReadInputTokens: usage?.cacheReadInputTokens ?? null
      },
      secrets
    )
  }

  return provider
}

/** One `claude -p` call's settings, shared by its schema retry. */
interface PrintCall {
  model: string
  schema: Record<string, unknown> | null
  webSearch: boolean
  timeoutMs: number
}

function retryClaudeCommand(result: CommandResult): boolean {
  if (result.spawnError === 'ENOENT') return false
  if (!result.timedOut && result.spawnError === null) return false
  // Never start `claude` again after a limit or a sign-in problem: that is a retry storm.
  return classifyClaudeFailure(`${result.stdout}\n${result.stderr}`) === null
}

/** The CLI rejected a flag that turns tools off. Running without it is not allowed. */
function toolRestrictionUnsupported(
  flag: RestrictionFlag,
  secrets: readonly string[]
): ClaudeCodeCallError {
  return new ClaudeCodeCallError(
    `This Claude Code version does not accept ${flag}, which CiteFox needs to turn tools off while Claude reads page text. Update Claude Code to version ${CLAUDE_CODE_MIN_VERSION} or newer, then try again.`,
    {
      code: 'spawn',
      state: 'warning',
      nextStep: `Update Claude Code to version ${CLAUDE_CODE_MIN_VERSION} or newer (run claude update in Terminal), then try again.`,
      secrets
    },
    null
  )
}

/**
 * A failed `claude -p` call. `resolvedModel` is taken from that call's
 * `modelUsage` so a checkup can store it even when the round trip fails.
 * `key_usage` is not written: that table requires an `api_keys` row, and
 * Claude Code login is not one (LLM-2, LLM-9).
 */
export class ClaudeCodeCallError extends ClaudeCallError {
  constructor(
    message: string,
    options: {
      code:
        | 'plan_limit'
        | 'plan_inactive'
        | 'credit_low'
        | 'unauthorized'
        | 'rate_limited'
        | 'overloaded'
        | 'logged_out'
        | 'validation'
        | 'malformed'
        | 'spawn'
      state: 'warning'
      nextStep: string | null
      secrets?: readonly string[]
      limit?: ClaudeLimitInfo | null
    },
    usage: ClaudeCliUsage | null
  ) {
    super(message, options, usage, usage === null ? null : resolvedModelId(usage.modelUsage))
    this.name = 'ClaudeCodeCallError'
  }
}

function failureFor(
  parsed: Extract<CliParse, { ok: false }>,
  usage: ClaudeCliUsage,
  secrets: readonly string[],
  now: Date
): ClaudeCodeCallError {
  if (parsed.reason === 'truncated') {
    return new ClaudeCodeCallError(
      'The Claude Code reply was cut off at the output token limit, so it was not used.',
      {
        code: 'malformed',
        state: 'warning',
        nextStep: 'Shorten the page text or the template, then try again.',
        secrets
      },
      usage
    )
  }
  if (parsed.reason === 'limit') {
    const limit = parsed.limit ?? { kind: 'unknown', resetsAt: null }
    const words = limitWords(limit, now)
    return new ClaudeCodeCallError(
      words.message,
      { code: 'plan_limit', state: 'warning', nextStep: words.nextStep, secrets, limit },
      usage
    )
  }
  if (
    parsed.reason === 'logged_out' ||
    parsed.reason === 'plan_inactive' ||
    parsed.reason === 'credit_low' ||
    parsed.reason === 'unauthorized'
  ) {
    const words = accountWords(parsed.reason, 'claude-code')
    return new ClaudeCodeCallError(
      words.message,
      { code: parsed.reason, state: 'warning', nextStep: words.nextStep, secrets },
      usage
    )
  }
  if (parsed.reason === 'rate_limited' || parsed.reason === 'overloaded') {
    const words = transientWords(parsed.reason)
    return new ClaudeCodeCallError(
      words.message,
      { code: parsed.reason, state: 'warning', nextStep: words.nextStep, secrets },
      usage
    )
  }
  if (parsed.reason === 'validation') {
    return new ClaudeCodeCallError(
      `Claude Code reply failed validation: ${parsed.detail}`,
      {
        code: 'validation',
        state: 'warning',
        nextStep: 'Check again.',
        secrets
      },
      usage
    )
  }
  const message = parsed.detail.trim()
  return new ClaudeCodeCallError(
    message.length > 0 ? message : 'Claude Code exited without a reason.',
    {
      code: parsed.reason === 'malformed' ? 'malformed' : 'spawn',
      state: 'warning',
      nextStep: 'Check again. If this keeps happening, run claude in Terminal.',
      secrets
    },
    usage
  )
}

const STDERR_LINE_LIMIT = 180

function commandFailureDetail(result: CommandResult, secrets: readonly string[]): string {
  const code = result.exitCode === null ? 'unknown' : String(result.exitCode)
  const line = firstStderrLine(result.stderr, secrets)
  if (line.length === 0) return `Claude Code exited with code ${code}.`
  return `Claude Code exited with code ${code}: ${line}`
}

function firstStderrLine(stderr: string, secrets: readonly string[]): string {
  const raw = stderr.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  const redacted = redactString(raw.trim(), { secrets })
  if (redacted.length <= STDERR_LINE_LIMIT) return redacted
  return `${redacted.slice(0, STDERR_LINE_LIMIT - 1)}…`
}
