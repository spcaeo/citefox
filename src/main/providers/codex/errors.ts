import type { ProviderErrorCode } from '../errors'
import { ClaudeCallError } from '../claude/call-error'
import type { ClaudeCliUsage } from '../claude/parse'
import type { CodexParse } from './parse'

/**
 * A failed Codex call. Like `ClaudeCodeCallError` it carries the tokens spent, so a
 * failed generation still records its cost. `resetsAt` is when a usage limit ends,
 * when Codex said; null for every other failure. Every message names Codex, never Claude.
 */
export class CodexCallError extends ClaudeCallError {
  readonly resetsAt: Date | null

  constructor(
    message: string,
    options: {
      code: ProviderErrorCode
      nextStep: string | null
      secrets?: readonly string[]
      resetsAt?: Date | null
    },
    usage: ClaudeCliUsage | null,
    resolvedModel: string | null
  ) {
    super(
      message,
      {
        code: options.code,
        state: 'warning',
        nextStep: options.nextStep,
        secrets: options.secrets
      },
      usage,
      resolvedModel
    )
    this.name = 'CodexCallError'
    this.resetsAt = options.resetsAt ?? null
  }
}

export const CODEX_INSTALL_STEP = 'Install Codex, or set its path in Settings, then try again.'
export const CODEX_LOGIN_STEP = 'Open Terminal, run codex login, and sign in with ChatGPT.'

/** "3:45 PM" today, else "Oct 30, 3:45 PM", in this computer's time zone. */
export function formatResetTime(at: Date, now: Date = new Date()): string {
  const sameDay = at.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat('en-US', {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit'
  }).format(at)
}

/** The plain-English error for a failed Codex run. */
export function codexFailure(
  parsed: Extract<CodexParse, { ok: false }>,
  usage: ClaudeCliUsage | null,
  model: string,
  secrets: readonly string[],
  now: Date = new Date()
): CodexCallError {
  const make = (
    message: string,
    code: ProviderErrorCode,
    nextStep: string | null,
    resetsAt: Date | null = null
  ): CodexCallError =>
    new CodexCallError(message, { code, nextStep, secrets, resetsAt }, usage, model)
  switch (parsed.reason) {
    case 'limit': {
      const when = parsed.resetsAt === null ? null : formatResetTime(parsed.resetsAt, now)
      return make(
        when === null
          ? 'Codex hit your ChatGPT usage limit. Earlier results are kept.'
          : `Codex hit your ChatGPT usage limit. It resets at ${when}. Earlier results are kept.`,
        'plan_limit',
        when === null
          ? 'Wait for the limit to reset, or switch the AI in Settings. Earlier results are kept.'
          : `Wait until ${when}, or switch the AI in Settings. Earlier results are kept.`,
        parsed.resetsAt
      )
    }
    case 'logged_out':
      return make(
        'Codex is signed out: open Terminal, run codex login and sign in.',
        'logged_out',
        CODEX_LOGIN_STEP
      )
    case 'rate_limited':
      return make(
        'Codex is getting too many requests right now.',
        'rate_limited',
        'Wait a minute, then try again.'
      )
    case 'overloaded':
      return make(
        'Codex is busy right now: its servers are at capacity.',
        'overloaded',
        'Try again in a few minutes.'
      )
    case 'model':
      return make(
        `Codex can't use the model ${model} with this sign-in.`,
        'validation',
        'Choose another Codex model in Settings, or clear it to use the default.'
      )
    case 'validation':
      return make(`Codex reply failed validation: ${parsed.detail}`, 'validation', 'Check again.')
    case 'schema_rejected':
      return make(
        'Codex refused the reply format CiteFox asked for.',
        'malformed',
        'Check again. If this keeps happening, update Codex.'
      )
    case 'malformed':
      return make(
        parsed.detail.includes('Codex')
          ? parsed.detail
          : `Codex returned a reply CiteFox could not read${parsed.detail.length > 0 ? `: ${parsed.detail}` : '.'}`,
        'malformed',
        'Check again.'
      )
    default:
      return make(
        parsed.detail.length > 0
          ? `Codex stopped: ${parsed.detail}`
          : 'Codex stopped without a reason.',
        'spawn',
        'Check again. If this keeps happening, run codex in Terminal.'
      )
  }
}
