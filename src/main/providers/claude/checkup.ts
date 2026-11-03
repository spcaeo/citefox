import { randomUUID } from 'node:crypto'
import type { ClaudeCheckupResult, ClaudeCheckupRow, ClaudeCheckupProgress } from '@shared/ipc'
import type {
  ClaudeCheckupPhase,
  ClaudeCheckupProgressState,
  ClaudeCheckupRowState
} from '@shared/ipc'
import { redactValue } from '../../logging/redact'
import type { SqliteDatabase } from '../../storage/database'
import { insertClaudeCheckup } from '../../storage/records'
import { ProviderError, ProviderTimeoutError, ClaudeLimitError } from '../errors'
import { logProvider, resolveSecretList } from '../log'
import type { ClaudeCodeProvider, ClaudeCodeProviderOptions } from './claude-code'
import { ClaudeCodeCallError, createClaudeCodeProvider } from './claude-code'
import { EventEmitter } from 'node:events'
import { planLabel } from '@shared/plan-label'

/** Fixed round-trip. It asks for JSON and does not include a secret or a page. */
export const CHECKUP_PROMPT =
  'Reply with JSON only, matching the schema: {"ok":true}. Do not use tools. Do not include any other text.'

export const CHECKUP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
  required: ['ok']
}

export interface RunClaudeCheckupOptions extends ClaudeCodeProviderOptions {
  db: SqliteDatabase
  /** This run only. Null uses `savedBinaryPath` (LLM-1). */
  binaryPath: string | null
  savedBinaryPath: string | null
  onProgress?: (event: ClaudeCheckupProgress) => void
  now?: () => Date
  id?: string
}

/**
 * LLM-8. Binary, login, then one round-trip. Each phase emits `running` and
 * then a terminal state. A skipped phase emits `skipped` only.
 * The result is stored in `claude_checkups`. The latest row is the current checkup.
 * LLM-9 / section 5.3: one login, no account switch, no OAuth read.
 */
export async function runClaudeCheckup(
  options: RunClaudeCheckupOptions
): Promise<ClaudeCheckupResult> {
  // "Check again" is how a person finds out a limit has reset, so it runs while paused.
  const provider = createClaudeCodeProvider({ ...options, ignorePause: true })
  return runWithProvider(provider, options)
}

export class ClaudeCheckupRunner extends EventEmitter {
  constructor(
    private readonly options: Omit<
      RunClaudeCheckupOptions,
      'onProgress' | 'binaryPath' | 'savedBinaryPath' | 'model' | 'id'
    >
  ) {
    super()
  }

  run(input: {
    binaryPath: string | null
    savedBinaryPath: string | null
    model?: string | null
    id?: string
  }): Promise<ClaudeCheckupResult> {
    return runClaudeCheckup({
      ...this.options,
      binaryPath: input.binaryPath,
      savedBinaryPath: input.savedBinaryPath,
      model: input.model ?? null,
      id: input.id,
      onProgress: (event) => {
        this.emit('progress', event)
      }
    })
  }
}

async function runWithProvider(
  provider: ClaudeCodeProvider,
  options: RunClaudeCheckupOptions
): Promise<ClaudeCheckupResult> {
  const secrets = (): string[] => resolveSecretList(options.secrets)
  const emit = (event: ClaudeCheckupProgress): void => {
    const safe = redactValue(event, { secrets: secrets() }) as ClaudeCheckupProgress
    options.onProgress?.(safe)
  }
  const finish = (result: ClaudeCheckupResult): ClaudeCheckupResult => {
    const safe = redactValue(result, { secrets: secrets() }) as ClaudeCheckupResult
    if (!safe.ready) {
      // One line for a check that did not pass: which step stopped it, never a path or message.
      logProvider(
        options.logger,
        'warn',
        'ai check did not pass',
        {
          provider: 'claude-code',
          binaryFound: safe.binaryPath !== null,
          login: safe.login,
          roundTrip: safe.roundTrip
        },
        secrets()
      )
    }
    insertClaudeCheckup(options.db, {
      id: options.id ?? randomUUID(),
      ranAt: (options.now ?? ((): Date => new Date()))().toISOString(),
      result: safe
    })
    return safe
  }

  const preferred = options.binaryPath ?? options.savedBinaryPath
  emit(progress('binary', 'running', 'Looking for Claude Code.', null))
  const located = provider.locate(preferred)
  if (located.path === null) {
    const missing = missingResult(located.source === 'override' ? 'override' : 'search')
    emit(progress('binary', 'warning', missing.rows.binary.detail, missing.rows.binary.nextStep))
    emit(progress('login', 'skipped', missing.rows.login.detail, null))
    emit(progress('roundTrip', 'skipped', missing.rows.roundTrip.detail, null))
    return finish(missing)
  }

  const version = await provider.readVersion(located.path)
  if (!version.ok) {
    if (version.reason === 'not_installed') {
      const missing = missingResult('override')
      emit(progress('binary', 'warning', missing.rows.binary.detail, missing.rows.binary.nextStep))
      emit(progress('login', 'skipped', missing.rows.login.detail, null))
      emit(progress('roundTrip', 'skipped', missing.rows.roundTrip.detail, null))
      return finish(missing)
    }
    const failed = versionFailedResult(located.path, version.reason)
    emit(progress('binary', 'warning', failed.rows.binary.detail, failed.rows.binary.nextStep))
    emit(progress('login', 'skipped', failed.rows.login.detail, null))
    emit(progress('roundTrip', 'skipped', failed.rows.roundTrip.detail, null))
    return finish(failed)
  }

  const binaryDetail = `${located.path} · version ${version.version}`
  emit(progress('binary', 'ok', binaryDetail, null))
  emit(progress('login', 'running', 'Checking the Claude Code login.', null))
  const login = await provider.readLogin(located.path)

  if (login.status === 'not_installed') {
    const missing = missingResult('override')
    emit(progress('login', 'warning', missing.rows.binary.detail, missing.nextStep))
    emit(progress('roundTrip', 'skipped', 'Runs after Claude Code is found', null))
    return finish(missingResult('override'))
  }
  if (login.status === 'timeout') {
    const failed = loginProblemResult(
      located.path,
      version.version,
      'Timed out',
      'Claude Code did not answer the login check in time.',
      'Check again. If it keeps timing out, confirm the binary path.',
      'logged_out'
    )
    emit(progress('login', 'warning', failed.rows.login.detail, failed.nextStep))
    emit(progress('roundTrip', 'skipped', failed.rows.roundTrip.detail, null))
    return finish(failed)
  }
  if (login.status === 'logged_out' || login.status === 'api_key') {
    const failed =
      login.status === 'logged_out'
        ? loggedOutResult(located.path, version.version)
        : apiKeyResult(located.path, version.version)
    emit(progress('login', 'warning', failed.rows.login.detail, failed.nextStep))
    emit(progress('roundTrip', 'skipped', failed.rows.roundTrip.detail, null))
    return finish(failed)
  }

  const knownPlan = login.status === 'logged_in' ? login.plan : null
  if (login.status === 'logged_in') {
    emit(progress('login', 'ok', knownPlan === null ? 'Logged in' : planLabel(knownPlan), null))
  }

  emit(progress('roundTrip', 'running', 'Sending a test call.', null))
  try {
    const completion = await provider.completeAt(located.path, {
      prompt: CHECKUP_PROMPT,
      schema: CHECKUP_SCHEMA,
      model: options.model ?? null
    })
    const confirmed =
      completion.json !== null &&
      typeof completion.json === 'object' &&
      !Array.isArray(completion.json) &&
      (completion.json as { ok?: unknown }).ok === true
    if (!confirmed) {
      const failed = roundTripFailedResult(
        located.path,
        version.version,
        knownPlan,
        null,
        completion.resolvedModel
      )
      if (login.status !== 'logged_in') {
        emit(
          progress('login', 'warning', 'Could not confirm the Claude Code login.', failed.nextStep)
        )
      }
      emit(progress('roundTrip', 'warning', failed.rows.roundTrip.detail, failed.nextStep))
      return finish(failed)
    }
    if (login.status !== 'logged_in') {
      emit(progress('login', 'ok', 'Logged in', null))
    }
    const ready = readyResult(
      located.path,
      version.version,
      knownPlan,
      completion.durationMs,
      completion.resolvedModel
    )
    emit(progress('roundTrip', 'ok', ready.rows.roundTrip.detail, null))
    return finish(ready)
  } catch (error) {
    const reportedModel = error instanceof ClaudeCodeCallError ? error.resolvedModel : null
    if (error instanceof ProviderError && error.code === 'logged_out') {
      const failed = loggedOutResult(located.path, version.version, reportedModel)
      emit(
        progress(
          'login',
          login.status === 'logged_in' ? 'warning' : 'warning',
          failed.rows.login.detail,
          failed.nextStep
        )
      )
      emit(progress('roundTrip', 'skipped', failed.rows.roundTrip.detail, null))
      return finish(failed)
    }
    const limit =
      error instanceof ClaudeLimitError ||
      (error instanceof ProviderError && error.code === 'plan_limit')
    const timedOut = error instanceof ProviderTimeoutError
    const accountStop =
      error instanceof ProviderError &&
      (error.code === 'plan_inactive' ||
        error.code === 'credit_low' ||
        error.code === 'unauthorized' ||
        error.code === 'rate_limited' ||
        error.code === 'overloaded')
    const failed = limit
      ? limitResult(
          located.path,
          version.version,
          knownPlan,
          reportedModel,
          error instanceof ProviderError ? error : null
        )
      : roundTripFailedResult(
          located.path,
          version.version,
          knownPlan,
          timedOut ? 'The test call timed out.' : accountStop ? error.message : null,
          reportedModel,
          accountStop ? error.nextStep : null
        )
    if (login.status !== 'logged_in') {
      const unconfirmed = loginProblemResult(
        located.path,
        version.version,
        'Not confirmed',
        'Could not confirm the Claude Code login.',
        failed.nextStep ?? 'Check again.',
        'logged_out'
      )
      emit(progress('login', 'warning', unconfirmed.rows.login.detail, unconfirmed.nextStep))
      emit(progress('roundTrip', 'warning', failed.rows.roundTrip.detail, failed.nextStep))
      return finish({
        ...failed,
        login: 'logged_out',
        rows: { ...failed.rows, login: unconfirmed.rows.login }
      })
    }
    emit(progress('roundTrip', 'warning', failed.rows.roundTrip.detail, failed.nextStep))
    return finish(failed)
  }
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`
  const seconds = durationMs / 1000
  const text = seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)
  return `${text} s`
}

function progress(
  phase: ClaudeCheckupPhase,
  state: ClaudeCheckupProgressState,
  detail: string,
  nextStep: string | null
): ClaudeCheckupProgress {
  return { phase, state, detail, nextStep: state === 'warning' ? nextStep : null }
}

function row(
  state: ClaudeCheckupRowState,
  statusLabel: string,
  detail: string,
  nextStep: string | null
): ClaudeCheckupRow {
  return { state, statusLabel, detail, nextStep: state === 'warning' ? nextStep : null }
}

function assemble(
  result: Omit<ClaudeCheckupResult, 'ready' | 'resolvedModel'> & {
    resolvedModel?: string | null
  }
): ClaudeCheckupResult {
  const { resolvedModel, ...rest } = result
  const withModel = { ...rest, resolvedModel: resolvedModel ?? null }
  const ready =
    withModel.rows.binary.state === 'ok' &&
    withModel.rows.login.state === 'ok' &&
    withModel.rows.roundTrip.state === 'ok'
  return { ...withModel, ready }
}

function missingResult(source: 'override' | 'search'): ClaudeCheckupResult {
  const override = source === 'override'
  const nextStep = override
    ? 'Install Claude Code, or tell CiteFox where it is, then check again.'
    : 'Install Claude Code, or set the path in Settings, then check again.'
  return assemble({
    binaryPath: null,
    version: null,
    login: 'skipped',
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    message: 'Claude Code was not found.',
    nextStep,
    rows: {
      binary: row(
        'warning',
        override ? 'Not found' : 'Not found on PATH',
        override
          ? 'CiteFox could not find Claude Code at that path.'
          : 'CiteFox looked on your PATH and in the usual install folders.',
        nextStep
      ),
      login: row('skipped', 'Skipped', 'Checked after Claude Code is found', null),
      roundTrip: row('skipped', 'Skipped', 'Runs after Claude Code is found', null)
    }
  })
}

function versionFailedResult(
  binaryPath: string,
  reason: 'timeout' | 'unreadable'
): ClaudeCheckupResult {
  const timeout = reason === 'timeout'
  const nextStep = timeout
    ? 'Check again. If it keeps timing out, confirm the binary path.'
    : 'Install Claude Code again, or set the path in Settings, then check again.'
  return assemble({
    binaryPath,
    version: null,
    login: 'skipped',
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    message: timeout
      ? 'Claude Code did not report its version in time.'
      : 'Claude Code did not report a version.',
    nextStep,
    rows: {
      binary: row(
        'warning',
        timeout ? 'Timed out' : 'No version',
        timeout
          ? 'Claude Code did not report its version in time.'
          : 'Claude Code did not report a version.',
        nextStep
      ),
      login: row('skipped', 'Skipped', 'Checked after Claude Code is found', null),
      roundTrip: row('skipped', 'Skipped', 'Runs after Claude Code is found', null)
    }
  })
}

function loggedOutResult(
  binaryPath: string,
  version: string,
  resolvedModel: string | null = null
): ClaudeCheckupResult {
  const nextStep = 'Open Terminal, run claude, and log in.'
  return assemble({
    binaryPath,
    version,
    login: 'logged_out',
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    resolvedModel,
    message: 'Claude Code is logged out: open Terminal, run claude and log in.',
    nextStep,
    rows: {
      binary: row('ok', 'OK', `${binaryPath} · version ${version}`, null),
      login: row(
        'warning',
        'Not logged in',
        'Claude Code is installed, but no account is logged in.',
        nextStep
      ),
      roundTrip: row('skipped', 'Skipped', 'Runs after you log in', null)
    }
  })
}

function apiKeyResult(binaryPath: string, version: string): ClaudeCheckupResult {
  const nextStep =
    'Open Terminal, run claude, and log in with your own plan. For client work, add an Anthropic API key in CiteFox.'
  return assemble({
    binaryPath,
    version,
    login: 'api_key',
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    message: 'Claude Code is using an API key, not a subscription login.',
    nextStep,
    rows: {
      binary: row('ok', 'OK', `${binaryPath} · version ${version}`, null),
      login: row(
        'warning',
        'API key only',
        'Claude Code is using an API key, not a subscription login.',
        nextStep
      ),
      roundTrip: row('skipped', 'Skipped', 'Runs after you log in with your plan', null)
    }
  })
}

function loginProblemResult(
  binaryPath: string,
  version: string,
  statusLabel: string,
  detail: string,
  nextStep: string,
  login: ClaudeCheckupResult['login']
): ClaudeCheckupResult {
  return assemble({
    binaryPath,
    version,
    login,
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    message: detail,
    nextStep,
    rows: {
      binary: row('ok', 'OK', `${binaryPath} · version ${version}`, null),
      login: row('warning', statusLabel, detail, nextStep),
      roundTrip: row('skipped', 'Skipped', 'Runs after the login check succeeds', null)
    }
  })
}

function readyResult(
  binaryPath: string,
  version: string,
  plan: string | null,
  durationMs: number,
  resolvedModel: string | null
): ClaudeCheckupResult {
  return assemble({
    binaryPath,
    version,
    login: 'logged_in',
    plan,
    roundTrip: 'ok',
    durationMs,
    resolvedModel,
    message:
      plan === null
        ? 'Claude Code is ready.'
        : `Claude Code is ready. CiteFox will run its analysis on your ${planLabel(plan)}.`,
    nextStep: null,
    rows: {
      binary: row('ok', 'OK', `${binaryPath} · version ${version}`, null),
      login: row('ok', 'OK', plan === null ? 'Logged in' : planLabel(plan), null),
      roundTrip: row('ok', 'OK', `Replied in ${formatDuration(durationMs)}`, null)
    }
  })
}

function roundTripFailedResult(
  binaryPath: string,
  version: string,
  plan: string | null,
  detail: string | null,
  resolvedModel: string | null,
  ownNextStep: string | null = null
): ClaudeCheckupResult {
  const nextStep =
    ownNextStep ??
    'Check again. If this keeps happening, run claude in Terminal and confirm you are logged in.'
  const line = detail ?? 'The test call did not return JSON CiteFox could read.'
  return assemble({
    binaryPath,
    version,
    login: 'logged_in',
    plan,
    roundTrip: 'failed',
    durationMs: null,
    resolvedModel,
    message: 'Claude Code did not answer the test call.',
    nextStep,
    rows: {
      binary: row('ok', 'OK', `${binaryPath} · version ${version}`, null),
      login: row('ok', 'OK', plan === null ? 'Logged in' : planLabel(plan), null),
      roundTrip: row('warning', 'No reply', line, nextStep)
    }
  })
}

function limitResult(
  binaryPath: string,
  version: string,
  plan: string | null,
  resolvedModel: string | null,
  error: ProviderError | null
): ClaudeCheckupResult {
  const nextStep =
    error?.nextStep ??
    'Wait for the plan limit to reset, or use an Anthropic API key. Earlier results are kept.'
  const said = error?.limit?.resetsAt ? error.message : null
  return assemble({
    binaryPath,
    version,
    login: 'logged_in',
    plan,
    roundTrip: 'failed',
    durationMs: null,
    resolvedModel,
    message: said ?? 'Claude Code hit a plan limit.',
    nextStep,
    rows: {
      binary: row('ok', 'OK', `${binaryPath} · version ${version}`, null),
      login: row('ok', 'OK', plan === null ? 'Logged in' : planLabel(plan), null),
      roundTrip: row(
        'warning',
        'Plan limit',
        said ?? 'Claude Code hit a plan limit during the test call.',
        nextStep
      )
    }
  })
}
