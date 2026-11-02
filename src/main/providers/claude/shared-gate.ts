import { createConcurrencyGate } from '../concurrency'
import type { ClaudeLimitInfo } from './limits'

type Gate = <T>(fn: () => Promise<T>) => Promise<T>

/**
 * LLM-7 "Calls at once". IPC handlers, check reports, and the scheduler each
 * build a provider per action, so a gate made per provider would not limit
 * anything across them. One gate per configured limit lives for the process
 * and is shared by Claude Code and the Anthropic API alike. When Settings
 * changes the limit, calls already queued finish on the old gate.
 */
const gates = new Map<number, Gate>()

export function sharedClaudeGate(limit: number): Gate {
  const existing = gates.get(limit)
  if (existing !== undefined) return existing
  const gate = createConcurrencyGate(limit)
  gates.set(limit, gate)
  return gate
}

/** Test-only. Drops every gate so a stuck test cannot hold slots for the next one. */
export function resetSharedClaudeGatesForTests(): void {
  gates.clear()
  pause = null
}

/**
 * No retry storm (LLM-10). Once a Claude Code call hits the plan limit, every later
 * call in this process fails at once with the same words until the reset (plus a
 * small margin), without starting `claude`. The pause belongs to one program path:
 * pointing Settings at another `claude` is a different program and is not paused.
 * Switching to an Anthropic API key is never paused, and a call that succeeds (the
 * checkup's "Check again" ignores the pause) clears it.
 */
export interface ClaudeCodePause {
  binaryPath: string
  /** Epoch ms when calls may start again. */
  until: number
  limit: ClaudeLimitInfo
}

/** Added to the reset time Claude gave, so the first call after it is not refused. */
export const CLAUDE_PAUSE_MARGIN_MS = 2 * 60_000
/** How long to pause when Claude did not say when the limit resets. */
export const CLAUDE_PAUSE_UNKNOWN_MS = 60 * 60_000

let pause: ClaudeCodePause | null = null

/** Told when a pause starts or is lifted early; not when it simply runs out. */
type PauseListener = (paused: boolean) => void
const listeners = new Set<PauseListener>()

/** Main pushes `claudeCode:pauseChanged` from here. Returns the unsubscribe. */
export function onClaudeCodePauseChange(listener: PauseListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function tell(paused: boolean): void {
  for (const listener of listeners) {
    try {
      listener(paused)
    } catch {
      // A window that went away must not stop the pause.
    }
  }
}

export function pauseClaudeCode(
  binaryPath: string,
  limit: ClaudeLimitInfo,
  nowMs: number
): ClaudeCodePause {
  const until =
    limit.resetsAt === null || limit.resetsAt.getTime() <= nowMs
      ? nowMs + CLAUDE_PAUSE_UNKNOWN_MS
      : limit.resetsAt.getTime() + CLAUDE_PAUSE_MARGIN_MS
  pause = { binaryPath, until, limit }
  tell(true)
  return pause
}

/**
 * The pause in force for this program, or null. `binaryPath` null (not known yet,
 * as in a cost estimate) matches any program.
 */
export function claudeCodePause(binaryPath: string | null, nowMs: number): ClaudeCodePause | null {
  if (pause === null) return null
  if (pause.until <= nowMs) {
    pause = null
    return null
  }
  if (binaryPath !== null && binaryPath !== pause.binaryPath) return null
  return pause
}

export function clearClaudeCodePause(): void {
  const was = pause
  pause = null
  if (was !== null) tell(false)
}
