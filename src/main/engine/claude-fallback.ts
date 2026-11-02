import type { ClaudeFallback } from '@shared/domain'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../providers/claude/claude-code'
import { describeResetTime, limitName } from '../providers/claude/limits'
import { CLAUDE_PAUSE_MARGIN_MS } from '../providers/claude/shared-gate'
import { ProviderError, type ProviderErrorCode } from '../providers/errors'

/**
 * LLM-10. How long a deferred check report waits before trying again when Claude did
 * not say when its limit resets. With a reset time, it waits until then (plus a margin).
 */
export const CLAUDE_WAIT_RETRY_MS = 60 * 60_000
export const CLAUDE_RETRY_LATER_MS = 15 * 60_000
/** The longest a timer can wait (`setTimeout` fires at once beyond 2^31 - 1 ms). */
export const MAX_CLAUDE_WAIT_MS = 2 ** 31 - 1

/** A limit: the plan or the API said "not now". */
const LIMIT_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'plan_limit',
  'rate_limited',
  'overloaded'
])

/** A connection that cannot answer at all. A bad reply (validation, malformed) is not one. */
const FAILURE_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'not_installed',
  'logged_out',
  'plan_inactive',
  'credit_low',
  'unauthorized',
  'missing_secret',
  'network',
  'timeout',
  'spawn'
])

/** Why a project's Claude calls stopped, and when a report may try again. */
export interface ClaudeHalt {
  rule: ClaudeFallback
  /** Null for `ask`: nothing is retried until the user acts. */
  retryAfterMs: number | null
  message: string
}

/**
 * LLM-10. The project's fallback stopped this call. The original message and next step
 * are kept for `wait`, so the user reads the same words a plan limit always gave.
 */
export class ClaudeHaltError extends ProviderError {
  readonly halt: ClaudeHalt

  constructor(
    message: string,
    nextStep: string | null,
    code: ProviderErrorCode,
    halt: ClaudeHalt,
    limit: ProviderError['limit'] = null
  ) {
    super(message, { code, state: 'warning', nextStep, limit })
    this.name = 'ClaudeHaltError'
    this.halt = halt
  }
}

/** A provider that follows a project's fallback rule (FR-11.7). */
export interface ProjectClaudeProvider extends ClaudeProvider {
  /** Set once a call was stopped by `wait`, `retry_later`, or `ask`. Later calls stop at once. */
  halt(): ClaudeHalt | null
}

export function isProjectClaudeProvider(
  provider: ClaudeProvider
): provider is ProjectClaudeProvider {
  return 'halt' in provider && typeof provider.halt === 'function'
}

export interface FallbackNotice {
  kind: 'claude_limit' | 'claude_fallback'
  keyId: string | null
  sentence: string
}

export interface ProjectClaudeOptions {
  primary: ClaudeProvider
  /** "Claude Code" or "Anthropic API · My key". */
  primaryLabel: string
  primaryKeyId: string | null
  rule: ClaudeFallback
  /** Built only when the rule is `switch_key` and the primary fails. */
  fallback?: () => { provider: ClaudeProvider; label: string; keyId: string } | null
  projectName: string | null
  /** Called once per attempt that reached a provider, with the key that served it. */
  onCall?: (keyId: string | null) => void
  /** Called once per provider instance, the first time the fallback rule acts. */
  onNotice?: (notice: FallbackNotice) => void
  /** Test seam for the reset-time arithmetic. */
  now?: () => Date
}

/**
 * FR-11.7 and LLM-10. Calls the project's connection; when it hits a limit or cannot
 * answer, follows the rule: switch to the named API key, or stop the call and mark the
 * provider halted (`wait`, `retry_later`, `ask`). Searches are never part of a Claude
 * call, so stopping here never repeats a search: the check keeps everything it stored.
 */
export function createProjectClaudeProvider(options: ProjectClaudeOptions): ProjectClaudeProvider {
  let halted: { error: ClaudeHaltError } | null = null
  let switched: { provider: ClaudeProvider; label: string; keyId: string } | null = null
  let noticed = false
  const notice = (value: FallbackNotice): void => {
    if (noticed) return
    noticed = true
    options.onNotice?.(value)
  }
  const now = options.now ?? ((): Date => new Date())
  const forWhom = options.projectName === null ? '' : ` for ${options.projectName}`
  const inProject = options.projectName === null ? '' : ` (${options.projectName})`
  return {
    id: options.primary.id,
    halt: () => halted?.error.halt ?? null,
    async complete(request: ClaudeCompletionRequest): Promise<ClaudeCompletion> {
      if (halted !== null) throw halted.error
      if (switched !== null) {
        options.onCall?.(switched.keyId)
        return switched.provider.complete(request)
      }
      try {
        options.onCall?.(options.primaryKeyId)
        return await options.primary.complete(request)
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error
        const limit = LIMIT_CODES.has(error.code)
        if (!limit && !FAILURE_CODES.has(error.code)) throw error
        const what = limit
          ? `${options.primaryLabel} hit its ${limitLabel(error)}${forWhom}`
          : `${failureReason(options.primaryLabel, error.code)}${inProject}`
        if (options.rule === 'switch_key') {
          const next = options.fallback?.() ?? null
          if (next === null) throw error
          switched = next
          notice({
            kind: 'claude_fallback',
            keyId: next.keyId,
            sentence: `${what}. CiteFox switched to "${next.label}", and nothing failed.`
          })
          options.onCall?.(next.keyId)
          return next.provider.complete(request)
        }
        const halt = haltFor(options.rule, what, limit, error, now())
        halted = {
          error: new ClaudeHaltError(
            options.rule === 'wait' ? error.message : halt.message,
            options.rule === 'wait' ? error.nextStep : nextStepFor(options.rule),
            error.code,
            halt,
            error.limit
          )
        }
        notice({ kind: 'claude_limit', keyId: options.primaryKeyId, sentence: halt.message })
        throw halted.error
      }
    }
  }
}

/**
 * The real reason a connection could not answer, in plain words. A missing or signed-out
 * Claude is never reported as a limit (owner audit: "will finish after the limit resets"
 * showed when Claude Code was not installed).
 */
function failureReason(label: string, code: ProviderErrorCode): string {
  switch (code) {
    case 'not_installed':
      return `${label} isn't installed on this computer`
    case 'logged_out':
      return `${label} is signed out`
    case 'plan_inactive':
      return `${label}'s Claude subscription is not active`
    case 'credit_low':
      return `${label} has run out of credit`
    case 'unauthorized':
      return `${label} rejected the key`
    case 'missing_secret':
      return `${label} has no key saved`
    case 'network':
      return `${label} could not be reached`
    case 'timeout':
      return `${label} did not answer in time`
    case 'spawn':
      return `${label} could not start`
    default:
      return `${label} failed`
  }
}

function limitLabel(error: ProviderError): string {
  if (error.code === 'rate_limited') return 'rate limit'
  if (error.code === 'overloaded') return 'busy limit (overloaded)'
  return error.limit === null ? 'usage limit' : limitName(error.limit.kind).replace('Claude ', '')
}

/**
 * Milliseconds until the limit Claude named resets, plus the pause margin, so the retry
 * lands after the shared pause lifts. Null when Claude gave no time.
 */
export function msUntilReset(error: ProviderError, now: Date): number | null {
  const resetsAt = error.limit?.resetsAt ?? null
  if (resetsAt === null) return null
  const wait = resetsAt.getTime() - now.getTime() + CLAUDE_PAUSE_MARGIN_MS
  return Math.min(MAX_CLAUDE_WAIT_MS, Math.max(60_000, wait))
}

function haltFor(
  rule: ClaudeFallback,
  what: string,
  limit: boolean,
  error: ProviderError,
  now: Date
): ClaudeHalt {
  const untilReset = limit ? msUntilReset(error, now) : null
  const resetsAt = error.limit?.resetsAt ?? null
  const when = untilReset === null || resetsAt === null ? null : describeResetTime(resetsAt, now)
  if (rule === 'retry_later') {
    // Trying again every 15 minutes before a known reset only fails again.
    if (when !== null && untilReset !== null && untilReset > CLAUDE_RETRY_LATER_MS) {
      return {
        rule,
        retryAfterMs: untilReset,
        message: `${what}. It resets ${when}, and CiteFox will try again then; searches already made are kept.`
      }
    }
    return {
      rule,
      retryAfterMs: CLAUDE_RETRY_LATER_MS,
      message: `${what}. CiteFox will try again in 15 minutes; searches already made are kept.`
    }
  }
  if (rule === 'ask') {
    return {
      rule,
      retryAfterMs: null,
      message:
        when === null
          ? `${what}. CiteFox stopped and is waiting for you; searches already made are kept.`
          : `${what} (it resets ${when}). CiteFox stopped and is waiting for you; searches already made are kept.`
    }
  }
  const transient = error.code === 'rate_limited' || error.code === 'overloaded'
  return {
    rule: 'wait',
    retryAfterMs: untilReset ?? (transient ? CLAUDE_RETRY_LATER_MS : CLAUDE_WAIT_RETRY_MS),
    message: !limit
      ? `${what}. CiteFox will finish the analysis once it works; searches already made are kept.`
      : when === null
        ? `${what}. CiteFox will finish the analysis after the limit resets; searches already made are kept.`
        : `${what}. It resets ${when}, and CiteFox will finish the analysis then; searches already made are kept.`
  }
}

function nextStepFor(rule: ClaudeFallback): string {
  if (rule === 'ask') {
    return 'Open Project settings → Claude to switch to an API key, or try again later.'
  }
  return 'Nothing to do now. Searches already made are kept.'
}
