import type { ConnectionState } from '@shared/domain'
import type { KeyTestReason } from '@shared/ipc'
import { redactString } from '../logging/redact'
import type { ClaudeLimitInfo } from './claude/limits'

export type ProviderErrorCode =
  | 'timeout'
  | 'malformed'
  | 'unauthorized'
  | 'rate_limited'
  | 'overloaded'
  | 'plan_limit'
  | 'plan_inactive'
  | 'credit_low'
  | 'not_installed'
  | 'logged_out'
  | 'network'
  | 'missing_secret'
  | 'validation'
  | 'spawn'

/**
 * A provider failure whose message has already been redacted (NFR-5).
 * `state` is the connection state E3 can store. `unchecked` is not used here:
 * a thrown error means a test was attempted.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly state: ConnectionState
  readonly nextStep: string | null
  /**
   * True when the request never reached the server (DNS failed, connection refused), so
   * nothing can have been billed and a paid call may be tried again (`mayRetryPaidCall`).
   */
  readonly notSent: boolean
  /** A plan limit's window and reset time, when Claude said. Null for every other failure. */
  readonly limit: ClaudeLimitInfo | null

  constructor(
    message: string,
    options: {
      code: ProviderErrorCode
      state: ConnectionState
      nextStep: string | null
      secrets?: readonly string[]
      notSent?: boolean
      limit?: ClaudeLimitInfo | null
    }
  ) {
    super(redactString(message, { secrets: options.secrets }))
    this.name = 'ProviderError'
    this.code = options.code
    this.state = options.state
    this.nextStep = options.nextStep
    this.notSent = options.notSent ?? false
    this.limit = options.limit ?? null
  }
}

export class ProviderTimeoutError extends ProviderError {
  readonly timeoutMs: number

  constructor(label: string, timeoutMs: number, secrets?: readonly string[]) {
    super(`${label} timed out after ${timeoutMs} ms`, {
      code: 'timeout',
      state: 'warning',
      nextStep: 'Check the network and try again.',
      secrets
    })
    this.name = 'ProviderTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * LLM-10. The call hit a plan or rate limit. CiteFox does not drop earlier
 * work: this error carries the failure and nothing else. Project fallback
 * (FR-11.7) is M5 and is not chosen here.
 */
export class ClaudeLimitError extends ProviderError {
  constructor(
    message: string,
    secrets?: readonly string[],
    limit: ClaudeLimitInfo | null = null,
    nextStep: string = CLAUDE_LIMIT_NEXT_STEP
  ) {
    super(message, {
      code: 'plan_limit',
      state: 'warning',
      nextStep,
      secrets,
      limit
    })
    this.name = 'ClaudeLimitError'
  }
}

export const CLAUDE_LIMIT_NEXT_STEP =
  'Wait for the plan limit to reset, or use an Anthropic API key. Earlier results are kept.'

/** Maps a provider failure onto `KeyTestResult.reason`. An `ok` test uses null instead. */
export function keyTestReasonForCode(code: ProviderErrorCode): KeyTestReason {
  if (code === 'timeout') return 'timeout'
  if (code === 'unauthorized') return 'rejected'
  if (code === 'rate_limited' || code === 'plan_limit' || code === 'overloaded') {
    return 'rate_limited'
  }
  return 'other'
}

export function wrapProviderError(error: unknown, secrets: readonly string[]): ProviderError {
  if (error instanceof ProviderError) {
    return new ProviderError(error.message, {
      code: error.code,
      state: error.state,
      nextStep: error.nextStep,
      secrets,
      notSent: error.notSent,
      limit: error.limit
    })
  }
  const message = error instanceof Error ? error.message : 'Provider request failed'
  return new ProviderError(message, {
    code: 'network',
    state: 'warning',
    nextStep: 'Try again.',
    secrets
  })
}
