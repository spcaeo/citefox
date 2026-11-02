import { DEFAULT_CLAUDE_CONCURRENCY } from '@shared/domain'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import type { BinaryProbe, LocatedBinary } from '../claude/binary'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../claude/claude-code'
import { schemaAttemptLimit } from '../claude/claude-code'
import type { ClaudeCliUsage } from '../claude/parse'
import { sumClaudeCliUsage } from '../claude/parse'
import { sharedClaudeGate } from '../claude/shared-gate'
import type { CommandRequest, CommandResult, CommandTransport, RetryBudget } from '../command'
import { runCommandWithRetry } from '../command'
import { ProviderError, ProviderTimeoutError } from '../errors'
import { logProvider, resolveSecretList } from '../log'
import {
  assertNoCodexAccountChange,
  codexExecArgs,
  isOptionalDisabledFeature,
  rejectedCodexArgument,
  rejectedCodexFeature,
  type CodexExecCall,
  type OptionalDisabledFeature
} from './args'
import { locateCodexBinary } from './binary'
import { scrubCodexEnv } from './env'
import { CODEX_INSTALL_STEP, CodexCallError, codexFailure } from './errors'
import { CODEX_REASONING_EFFORT, resolveCodexModel } from './model'
import type { CodexLoginProbe, CodexParse } from './parse'
import {
  parseCodexExecOutput,
  parseCodexLoginStatus,
  parseCodexVersion,
  withModelUsage
} from './parse'
import { schemaPromptSuffix, strictCodexSchema } from './schema'

/** One `codex exec` call. Codex starts slower than Claude Code, so it gets the same 180 s. */
export const CODEX_COMPLETION_TIMEOUT_MS = 180_000

/** A web-search call: several searches, then the reply. A timed-out search is not repeated. */
export const CODEX_WEB_SEARCH_TIMEOUT_MS = 180_000

/** The first call, at most one transport retry, at most one schema retry (as Claude Code). */
export const CODEX_TRANSPORT_RETRIES = 1

export interface CodexTimeouts {
  versionMs: number
  loginMs: number
  completeMs: number
}

const DEFAULT_TIMEOUTS: CodexTimeouts = {
  versionMs: 10_000,
  loginMs: 15_000,
  completeMs: CODEX_COMPLETION_TIMEOUT_MS
}

export interface CodexProviderOptions {
  command: CommandTransport
  probe: BinaryProbe
  logger: Logger
  /** "Calls at once": the same process-wide gate as Claude (`sharedClaudeGate`). */
  concurrency?: number
  /** Saved Settings path. Null searches PATH and the usual folders. */
  savedBinaryPath?: string | null
  /** Settings `codexModel` (heavy jobs). Null uses `DEFAULT_CODEX_MODEL`. */
  model?: string | null
  /** Settings `codexQuickModel` (quick jobs). Null uses `DEFAULT_CODEX_QUICK_MODEL`. */
  quickModel?: string | null
  home?: string
  platform?: NodeJS.Platform
  pathEnv?: string
  baseEnv?: NodeJS.ProcessEnv
  sleep?: (ms: number) => Promise<void>
  clock?: () => number
  secrets?: readonly string[] | (() => readonly string[])
  timeouts?: Partial<CodexTimeouts>
}

export interface CodexProvider extends ClaudeProvider {
  readonly id: 'codex'
  locate(preferred: string | null): LocatedBinary
  readVersion(
    binaryPath: string
  ): Promise<
    | { ok: true; version: string }
    | { ok: false; reason: 'not_installed' | 'timeout' | 'unreadable' }
  >
  readLogin(
    binaryPath: string
  ): Promise<CodexLoginProbe | { status: 'timeout' } | { status: 'not_installed' }>
  completeAt(binaryPath: string, request: ClaudeCompletionRequest): Promise<ClaudeCompletion>
}

/**
 * Optional features this process has seen a Codex refuse as unknown, and schemas
 * OpenAI refused in strict mode. Shared by every provider so neither is tried again.
 */
const omittedFeatures = new Set<OptionalDisabledFeature>()

/** Test-only. Production keeps the decision until the process exits. */
export function resetCodexFlagSupportForTests(): void {
  omittedFeatures.clear()
}

/** One reply's settings, shared by its schema retry. */
interface ExecPlan {
  model: string
  effort: string
  schema: Record<string, unknown> | null
  /** Null: the schema cannot be strict, so it goes in the prompt instead. */
  strictSchema: Record<string, unknown> | null
  webSearch: boolean
  timeoutMs: number
}

/**
 * The OpenAI Codex CLI as a CiteFox AI connection, with the same contract as
 * Claude Code: plain and JSON-schema replies (one schema retry), web search for the
 * competitor step, timeouts, the shared "calls at once" gate, and plain-English
 * errors (`ProviderError` codes `not_installed`, `logged_out`, `plan_limit` with
 * `resetsAt`, `rate_limited`, `overloaded`, `timeout`, `malformed`). Every run is
 * locked down: see `codexExecArgs`. Calls are logged to `llm_calls` by `withCallLog`
 * with connection `codex`.
 */
export function createCodexProvider(options: CodexProviderOptions): CodexProvider {
  const gate = sharedClaudeGate(options.concurrency ?? DEFAULT_CLAUDE_CONCURRENCY)
  const clock = options.clock ?? Date.now
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts }
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  const secretsNow = (): string[] => resolveSecretList(options.secrets)

  const run = async (
    binaryPath: string,
    args: readonly string[],
    stdin: string,
    timeoutMs: number,
    budget?: RetryBudget
  ): Promise<CommandResult> => {
    assertNoCodexAccountChange(args)
    const secrets = secretsNow()
    const request: Omit<CommandRequest, 'signal'> = {
      command: binaryPath,
      args,
      stdin,
      env: scrubCodexEnv(options.baseEnv ?? process.env),
      timeoutMs
    }
    const result = await runCommandWithRetry(options.command, request, {
      sleep: options.sleep,
      secrets,
      shouldRetry: retryCodexCommand,
      ...(budget === undefined ? {} : { budget })
    })
    logProvider(
      options.logger,
      result.timedOut || result.spawnError !== null || result.exitCode !== 0 ? 'warn' : 'info',
      'codex command finished',
      {
        args,
        stdinChars: stdin.length,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        spawnError: result.spawnError,
        stderr: result.stderr.slice(0, 500)
      },
      secrets
    )
    return result
  }

  const provider: CodexProvider = {
    id: 'codex',
    locate(preferred: string | null): LocatedBinary {
      return locateCodexBinary(preferred, options.probe, {
        home,
        platform,
        pathEnv: options.pathEnv === undefined ? process.env.PATH : options.pathEnv
      })
    },
    async readVersion(binaryPath: string) {
      const result = await run(binaryPath, ['--version'], '', timeouts.versionMs)
      if (result.spawnError === 'ENOENT') return { ok: false, reason: 'not_installed' }
      if (result.timedOut) return { ok: false, reason: 'timeout' }
      const version = parseCodexVersion(result.stdout)
      if (version === null) return { ok: false, reason: 'unreadable' }
      return { ok: true, version }
    },
    async readLogin(binaryPath: string) {
      const result = await run(binaryPath, ['login', 'status'], '', timeouts.loginMs)
      if (result.spawnError === 'ENOENT') return { status: 'not_installed' }
      if (result.timedOut) return { status: 'timeout' }
      return parseCodexLoginStatus(result.stdout, result.stderr)
    },
    async complete(request: ClaudeCompletionRequest): Promise<ClaudeCompletion> {
      const located = provider.locate(options.savedBinaryPath ?? null)
      if (located.path === null) {
        throw new ProviderError('Codex was not found on this computer.', {
          code: 'not_installed',
          state: 'warning',
          nextStep: CODEX_INSTALL_STEP,
          secrets: secretsNow()
        })
      }
      return provider.completeAt(located.path, request)
    },
    async completeAt(binaryPath: string, request: ClaudeCompletionRequest) {
      return gate(() => completeNow(binaryPath, request))
    }
  }

  async function completeNow(
    binaryPath: string,
    request: ClaudeCompletionRequest
  ): Promise<ClaudeCompletion> {
    const started = clock()
    const secrets = secretsNow()
    const { model, size } = resolveCodexModel(request, {
      model: options.model,
      quickModel: options.quickModel
    })
    const schema = request.schema ?? null
    const web = request.webSearch === true
    const plan: ExecPlan = {
      model,
      effort: CODEX_REASONING_EFFORT[size],
      schema,
      strictSchema: schema === null ? null : strictCodexSchema(schema),
      webSearch: web,
      timeoutMs: web
        ? Math.min(timeouts.completeMs, CODEX_WEB_SEARCH_TIMEOUT_MS)
        : timeouts.completeMs
    }
    // A timed-out web search is not started again: it already took minutes.
    const budget: RetryBudget = { retriesLeft: web ? 0 : CODEX_TRANSPORT_RETRIES }
    const usages: (ClaudeCliUsage | null)[] = []
    try {
      let parsed = await execute(binaryPath, request.prompt, plan, secrets, budget)
      usages.push(parsed.usage)
      if (!parsed.ok && parsed.reason === 'validation' && schemaAttemptLimit(request) > 1) {
        const prompt = `${request.prompt}\n\nThe previous reply failed validation: ${parsed.detail}. Reply with JSON that matches the schema.`
        parsed = await execute(binaryPath, prompt, plan, secrets, budget)
        usages.push(parsed.usage)
      }
      const usage = withModelUsage(sumClaudeCliUsage(usages), model)
      if (!parsed.ok) throw codexFailure(parsed, usage, model, secrets, new Date(clock()))
      const durationMs = Math.max(0, clock() - started)
      logCall(durationMs, 'ok', model, usage, secrets, parsed.webSearches)
      return {
        provider: 'codex',
        text: parsed.text,
        json: parsed.json,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs,
        model,
        resolvedModel: model,
        usage,
        attempts: usages.length
      }
    } catch (error) {
      const durationMs = Math.max(0, clock() - started)
      const wrapped =
        error instanceof ProviderError
          ? error
          : new ProviderError(error instanceof Error ? error.message : 'Codex failed', {
              code: 'spawn',
              state: 'warning',
              nextStep: 'Check again.',
              secrets
            })
      const usage =
        wrapped instanceof CodexCallError
          ? wrapped.usage
          : usages.length > 0
            ? sumClaudeCliUsage(usages)
            : null
      logCall(
        durationMs,
        wrapped.code === 'plan_limit' ? 'limit' : 'error',
        model,
        usage,
        secrets,
        0
      )
      throw wrapped
    }
  }

  /**
   * One reply. An optional feature this Codex does not know is dropped and the run
   * repeated; an unknown required one, or an unknown flag, is an update message.
   * A schema OpenAI refuses in strict mode is sent in the prompt instead, once.
   */
  async function execute(
    binaryPath: string,
    prompt: string,
    plan: ExecPlan,
    secrets: readonly string[],
    budget: RetryBudget
  ): Promise<CodexParse> {
    let strict = plan.strictSchema
    for (;;) {
      const schemaDir = strict === null ? null : mkdtempSync(join(tmpdir(), 'citefox-codex-'))
      try {
        const schemaPath = schemaDir === null ? null : join(schemaDir, 'schema.json')
        if (schemaPath !== null) writeFileSync(schemaPath, JSON.stringify(strict), { mode: 0o600 })
        const call: CodexExecCall = {
          model: plan.model,
          effort: plan.effort,
          schemaPath,
          webSearch: plan.webSearch
        }
        const stdin =
          plan.schema !== null && strict === null
            ? prompt + schemaPromptSuffix(plan.schema)
            : prompt
        const result = await run(
          binaryPath,
          codexExecArgs(call, omittedFeatures),
          stdin,
          plan.timeoutMs,
          budget
        )
        const feature = rejectedCodexFeature(result)
        if (feature !== null) {
          if (!isOptionalDisabledFeature(feature) || omittedFeatures.has(feature)) {
            throw unsupportedCodex(`--disable ${feature}`, secrets)
          }
          omittedFeatures.add(feature)
          logProvider(
            options.logger,
            'warn',
            `Codex does not know the feature ${feature}; retrying without turning it off`,
            { feature },
            secrets
          )
          continue
        }
        const argument = rejectedCodexArgument(result)
        if (argument !== null) throw unsupportedCodex(argument, secrets)
        const parsed = finish(result, plan, secrets)
        if (!parsed.ok && parsed.reason === 'schema_rejected' && strict !== null) {
          strict = null
          continue
        }
        return parsed
      } finally {
        if (schemaDir !== null) removeDir(schemaDir)
      }
    }
  }

  function finish(result: CommandResult, plan: ExecPlan, secrets: readonly string[]): CodexParse {
    if (result.spawnError === 'ENOENT') {
      throw new ProviderError('Codex is not installed.', {
        code: 'not_installed',
        state: 'warning',
        nextStep: CODEX_INSTALL_STEP,
        secrets
      })
    }
    if (result.timedOut) throw new ProviderTimeoutError('Codex', plan.timeoutMs, secrets)
    if (result.spawnError !== null) {
      return {
        ok: false,
        reason: 'error',
        detail: `Codex could not start (${result.spawnError}).`,
        usage: null,
        resetsAt: null
      }
    }
    return parseCodexExecOutput(
      result.stdout,
      result.stderr,
      plan.schema,
      secrets,
      new Date(clock())
    )
  }

  function logCall(
    durationMs: number,
    outcome: 'ok' | 'limit' | 'error',
    model: string,
    usage: ClaudeCliUsage | null,
    secrets: readonly string[],
    webSearches: number
  ): void {
    logProvider(
      options.logger,
      outcome === 'ok' ? 'info' : 'warn',
      'codex call finished',
      {
        provider: 'codex',
        durationMs,
        outcome,
        model,
        webSearches,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        cacheReadInputTokens: usage?.cacheReadInputTokens ?? null
      },
      secrets
    )
  }

  return provider
}

function retryCodexCommand(result: CommandResult): boolean {
  if (result.spawnError === 'ENOENT') return false
  return result.timedOut || result.spawnError !== null
}

function unsupportedCodex(flag: string, secrets: readonly string[]): CodexCallError {
  return new CodexCallError(
    redactString(
      `This Codex version does not accept ${flag}, which CiteFox needs to keep Codex from running commands or changing files. Update Codex, then try again.`,
      { secrets }
    ),
    {
      code: 'spawn',
      nextStep: 'Update Codex (run codex update in Terminal), then try again.',
      secrets
    },
    null,
    null
  )
}

function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // A leftover temp schema file holds no page text or secret; the OS cleans tmp.
  }
}
