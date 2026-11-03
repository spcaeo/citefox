import { randomUUID } from 'node:crypto'
import type {
  ClaudeCheckupPhase,
  ClaudeCheckupProgress,
  ClaudeCheckupProgressState,
  ClaudeCheckupResult,
  ClaudeCheckupRow,
  ClaudeCheckupRowState
} from '@shared/ipc'
import { redactValue } from '../../logging/redact'
import type { SqliteDatabase } from '../../storage/database'
import { insertClaudeCheckup } from '../../storage/records'
import { CHECKUP_PROMPT, CHECKUP_SCHEMA, formatDuration } from '../claude/checkup'
import { ProviderError, ProviderTimeoutError } from '../errors'
import { logProvider, resolveSecretList } from '../log'
import type { CodexProviderOptions } from './codex'
import { createCodexProvider } from './codex'
import { CODEX_INSTALL_STEP, CODEX_LOGIN_STEP } from './errors'

export interface RunCodexCheckupOptions extends CodexProviderOptions {
  db: SqliteDatabase
  /** This run only. Null uses `savedBinaryPath`. */
  binaryPath: string | null
  savedBinaryPath: string | null
  onProgress?: (event: ClaudeCheckupProgress) => void
  now?: () => Date
  id?: string
}

/**
 * The Codex version of the AI step's checks, with the same three rows as Claude Code:
 * the program (`codex --version`), the sign-in (`codex login status`), then one test
 * reply. The result is stored with the Claude checkups (`provider: 'codex'`), so the
 * latest row is the current check whichever AI was chosen. CiteFox never reads the
 * Codex login file and never signs in or out for the user.
 */
export async function runCodexCheckup(
  options: RunCodexCheckupOptions
): Promise<ClaudeCheckupResult> {
  const provider = createCodexProvider(options)
  const secrets = (): string[] => resolveSecretList(options.secrets)
  const emit = (event: ClaudeCheckupProgress): void => {
    options.onProgress?.(redactValue(event, { secrets: secrets() }) as ClaudeCheckupProgress)
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
          provider: 'codex',
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
  const stop = (result: ClaudeCheckupResult, from: ClaudeCheckupPhase): ClaudeCheckupResult => {
    for (const phase of PHASES.slice(PHASES.indexOf(from))) {
      const source = result.rows[phase]
      emit(progress(phase, source.state, source.detail, source.nextStep))
    }
    return finish(result)
  }

  emit(progress('binary', 'running', 'Looking for Codex.', null))
  const located = provider.locate(options.binaryPath ?? options.savedBinaryPath)
  if (located.path === null) return stop(missingResult(located.source === 'override'), 'binary')
  const version = await provider.readVersion(located.path)
  if (!version.ok) {
    if (version.reason === 'not_installed') return stop(missingResult(true), 'binary')
    return stop(versionFailedResult(located.path, version.reason === 'timeout'), 'binary')
  }
  const found: Found = { binaryPath: located.path, version: version.version }
  emit(progress('binary', 'ok', foundDetail(found), null))

  emit(progress('login', 'running', 'Checking the Codex sign-in.', null))
  const login = await provider.readLogin(located.path)
  if (login.status === 'not_installed') return stop(missingResult(true), 'binary')
  if (login.status === 'timeout') {
    return stop(
      loginProblem(
        found,
        'Timed out',
        'Codex did not answer the sign-in check in time.',
        'Check again.'
      ),
      'login'
    )
  }
  if (login.status === 'logged_out') {
    return stop(
      loginProblem(found, 'Not signed in', login.detail, CODEX_LOGIN_STEP, 'logged_out'),
      'login'
    )
  }
  if (login.status === 'api_key') {
    return stop(
      loginProblem(
        found,
        'API key only',
        login.detail,
        'Open Terminal, run codex login, and sign in with ChatGPT instead.',
        'api_key'
      ),
      'login'
    )
  }
  const plan = login.status === 'logged_in' ? login.plan : null
  const signedIn = plan === null ? 'Signed in' : `Signed in with ${plan}`
  if (login.status === 'logged_in') emit(progress('login', 'ok', signedIn, null))

  emit(progress('roundTrip', 'running', 'Sending a test call.', null))
  try {
    const completion = await provider.completeAt(located.path, {
      prompt: CHECKUP_PROMPT,
      schema: CHECKUP_SCHEMA,
      model: options.quickModel ?? null
    })
    const json = completion.json
    const confirmed =
      json !== null && typeof json === 'object' && (json as { ok?: unknown }).ok === true
    if (!confirmed) {
      return stop(roundTripFailed(found, plan, null, completion.resolvedModel), 'login')
    }
    const ready = assemble({
      ...found,
      login: 'logged_in',
      plan,
      roundTrip: 'ok',
      durationMs: completion.durationMs,
      resolvedModel: completion.resolvedModel,
      message: 'Codex is ready. CiteFox will run its analysis with your ChatGPT sign-in.',
      nextStep: null,
      rows: {
        binary: row('ok', 'OK', foundDetail(found), null),
        login: row('ok', 'OK', signedIn, null),
        roundTrip: row('ok', 'OK', `Replied in ${formatDuration(completion.durationMs)}`, null)
      }
    })
    return stop(ready, 'login')
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'logged_out') {
      return stop(
        loginProblem(found, 'Not signed in', error.message, CODEX_LOGIN_STEP, 'logged_out'),
        'login'
      )
    }
    if (error instanceof ProviderError && error.code === 'plan_limit') {
      return stop(limitResult(found, plan, error.message, error.nextStep), 'login')
    }
    const detail =
      error instanceof ProviderTimeoutError
        ? 'The test call timed out.'
        : error instanceof ProviderError
          ? error.message
          : null
    return stop(roundTripFailed(found, plan, detail, null), 'login')
  }
}

const PHASES: readonly ClaudeCheckupPhase[] = ['binary', 'login', 'roundTrip']

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
  result: Omit<ClaudeCheckupResult, 'ready' | 'provider' | 'resolvedModel'> & {
    resolvedModel?: string | null
  }
): ClaudeCheckupResult {
  const ready =
    result.rows.binary.state === 'ok' &&
    result.rows.login.state === 'ok' &&
    result.rows.roundTrip.state === 'ok'
  return { provider: 'codex', ...result, resolvedModel: result.resolvedModel ?? null, ready }
}

const SKIPPED_AFTER_FOUND = {
  login: row('skipped', 'Skipped', 'Checked after Codex is found', null),
  roundTrip: row('skipped', 'Skipped', 'Runs after Codex is found', null)
}

function missingResult(override: boolean): ClaudeCheckupResult {
  const nextStep = override
    ? 'Install Codex, or tell CiteFox where it is, then check again.'
    : CODEX_INSTALL_STEP.replace('try again', 'check again')
  return assemble({
    binaryPath: null,
    version: null,
    login: 'skipped',
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    message: 'Codex was not found.',
    nextStep,
    rows: {
      binary: row(
        'warning',
        override ? 'Not found' : 'Not found on PATH',
        override
          ? 'CiteFox could not find Codex at that path.'
          : 'CiteFox looked on your PATH and in the usual install folders.',
        nextStep
      ),
      ...SKIPPED_AFTER_FOUND
    }
  })
}

function versionFailedResult(binaryPath: string, timedOut: boolean): ClaudeCheckupResult {
  const nextStep = timedOut
    ? 'Check again. If it keeps timing out, confirm the Codex path.'
    : 'Install Codex again, or set its path in Settings, then check again.'
  const detail = timedOut
    ? 'Codex did not report its version in time.'
    : 'Codex did not report a version.'
  return assemble({
    binaryPath,
    version: null,
    login: 'skipped',
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    message: detail,
    nextStep,
    rows: {
      binary: row('warning', timedOut ? 'Timed out' : 'No version', detail, nextStep),
      ...SKIPPED_AFTER_FOUND
    }
  })
}

/** Where Codex was found and the version it reported. */
interface Found {
  binaryPath: string
  version: string
}

function foundDetail(found: Found): string {
  return `${found.binaryPath} · version ${found.version}`
}

function loginProblem(
  found: Found,
  statusLabel: string,
  detail: string,
  nextStep: string,
  login: ClaudeCheckupResult['login'] = 'logged_out'
): ClaudeCheckupResult {
  return assemble({
    ...found,
    login,
    plan: null,
    roundTrip: 'skipped',
    durationMs: null,
    message:
      login === 'logged_out' && statusLabel === 'Not signed in'
        ? 'Codex is signed out: open Terminal, run codex login and sign in.'
        : detail,
    nextStep,
    rows: {
      binary: row('ok', 'OK', foundDetail(found), null),
      login: row('warning', statusLabel, detail, nextStep),
      roundTrip: row('skipped', 'Skipped', 'Runs after you sign in', null)
    }
  })
}

function roundTripFailed(
  found: Found,
  plan: string | null,
  detail: string | null,
  resolvedModel: string | null
): ClaudeCheckupResult {
  const nextStep =
    'Check again. If this keeps happening, run codex in Terminal and confirm you are signed in.'
  return assemble({
    ...found,
    login: 'logged_in',
    plan,
    roundTrip: 'failed',
    durationMs: null,
    resolvedModel,
    message: 'Codex did not answer the test call.',
    nextStep,
    rows: {
      binary: row('ok', 'OK', foundDetail(found), null),
      login: row('ok', 'OK', plan === null ? 'Signed in' : `Signed in with ${plan}`, null),
      roundTrip: row(
        'warning',
        'No reply',
        detail ?? 'The test call did not return JSON CiteFox could read.',
        nextStep
      )
    }
  })
}

function limitResult(
  found: Found,
  plan: string | null,
  message: string,
  nextStep: string | null
): ClaudeCheckupResult {
  const step = nextStep ?? 'Wait for the limit to reset. Earlier results are kept.'
  return assemble({
    ...found,
    login: 'logged_in',
    plan,
    roundTrip: 'failed',
    durationMs: null,
    message,
    nextStep: step,
    rows: {
      binary: row('ok', 'OK', foundDetail(found), null),
      login: row('ok', 'OK', plan === null ? 'Signed in' : `Signed in with ${plan}`, null),
      roundTrip: row('warning', 'Usage limit', 'Codex hit your ChatGPT usage limit.', step)
    }
  })
}
