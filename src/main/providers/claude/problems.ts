import type { ProviderErrorCode } from '../errors'
import {
  describeResetTime,
  limitName,
  type ClaudeAccountProblem,
  type ClaudeLimitInfo
} from './limits'

/**
 * The words a person reads when Claude stops. Only the message crosses IPC to the
 * window (the next step does not), so each message says what happened, what was kept,
 * and what the person can do, in that order.
 */
export interface ClaudeProblemWords {
  code: ProviderErrorCode
  message: string
  nextStep: string
}

export const API_KEY_CHOICE = 'add an Anthropic API key in Connections and keys'

/** A plan limit. `when` reads "today at 7:30 PM" or "Sunday, Nov 2 at 9:00 AM". */
export function limitWords(limit: ClaudeLimitInfo, now: Date, zone?: string): ClaudeProblemWords {
  const name = limitName(limit.kind)
  const when = limit.resetsAt === null ? null : describeResetTime(limit.resetsAt, now, zone)
  const what =
    when === null
      ? `You've reached your ${name}, and Claude did not say when it resets.`
      : `You've reached your ${name}. It resets ${when}.`
  return {
    code: 'plan_limit',
    message: `${what} Work already done is kept. You can wait, ${API_KEY_CHOICE}, or carry on with the steps that don't need AI.`,
    nextStep:
      when === null
        ? `Wait a while and try again, or ${API_KEY_CHOICE}. Steps that don't need AI still work.`
        : `Wait until ${when}, or ${API_KEY_CHOICE}. Steps that don't need AI still work.`
  }
}

/** The account (not the request) is the problem. `via` says which connection. */
export function accountWords(
  problem: ClaudeAccountProblem,
  via: 'claude-code' | 'anthropic-api'
): ClaudeProblemWords {
  if (problem === 'logged_out') {
    return {
      code: 'logged_out',
      message:
        'Claude Code is signed out, so CiteFox cannot use it. Open Terminal, run claude, type /login and sign in, then try again. Work already done is kept.',
      nextStep: 'Open Terminal, run claude, and log in.'
    }
  }
  if (problem === 'plan_inactive') {
    return {
      code: 'plan_inactive',
      message: `Your Claude subscription is not active, so Claude Code cannot answer. Renew it at claude.ai (Settings › Billing), or ${API_KEY_CHOICE}. Work already done is kept.`,
      nextStep: `Renew your Claude plan at claude.ai, or ${API_KEY_CHOICE}.`
    }
  }
  if (problem === 'credit_low') {
    return {
      code: 'credit_low',
      message:
        via === 'anthropic-api'
          ? 'Your Anthropic API key has run out of credit. Add credit at platform.claude.com (Settings › Billing), or switch this project to Claude Code. Work already done is kept.'
          : 'The API key Claude Code uses has run out of credit. Add credit at platform.claude.com (Settings › Billing), or sign Claude Code in to your Claude plan with /login. Work already done is kept.',
      nextStep: 'Add credit at platform.claude.com, then try again.'
    }
  }
  return {
    code: 'unauthorized',
    message:
      via === 'anthropic-api'
        ? 'Anthropic rejected this API key: it is wrong, revoked or expired. Paste a new key in Connections and keys, then try again.'
        : 'Claude Code was refused (401): its sign-in or API key is not valid. Open Terminal, run claude, type /login and sign in again.',
    nextStep:
      via === 'anthropic-api'
        ? 'Create a key in the Anthropic console and replace this one.'
        : 'Open Terminal, run claude, and log in again.'
  }
}

/** A short "try again shortly" from Anthropic. */
export function transientWords(code: 'rate_limited' | 'overloaded'): ClaudeProblemWords {
  return code === 'overloaded'
    ? {
        code,
        message:
          'Claude is busy right now (overloaded). Work already done is kept. Try again in a few minutes.',
        nextStep: 'Try again in a few minutes.'
      }
    : {
        code,
        message:
          'Claude is getting too many requests right now (rate limit). Work already done is kept. Try again in a few minutes.',
        nextStep: 'Try again in a few minutes.'
      }
}
