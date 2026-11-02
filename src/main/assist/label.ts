import type { AssistLabel } from '@shared/ipc'
import { planProjectClaude, readProjectClaude } from '../engine/claude'
import type { EngineHost } from '../engine/host'
import type { SqliteDatabase } from '../storage/database'
import { recentDurations } from '../storage/llm-calls'
import { connectionText } from './progress-labels'

/**
 * FR-25.1 "Claude · on your plan · about 6 s". The connection is the one the
 * call will use: the test seam, else the project's connection as `resolveClaude`
 * picks it (FR-11.7: its own Claude Code or API key, or Settings for `app_default`
 * and for no project). The duration is the median of this step's recent successful
 * calls in `llm_calls`, else the shipped estimate.
 */
export function connectionOf(
  host: EngineHost,
  projectId: string | null = null
): 'claude-code' | 'anthropic-api' | 'codex' {
  if (host.claude !== undefined) return host.claude.id
  const settings = host.settings()
  const plan = planProjectClaude(host.storage, settings, projectId)
  if (plan.connection !== null) {
    return plan.connection.kind === 'api-key' ? 'anthropic-api' : plan.connection.kind
  }
  // A missing key: the call will fail asking for one, so name the API connection it wants.
  const chosen = readProjectClaude(host.storage, projectId).claude.connection
  if (chosen === 'claude_code') return 'claude-code'
  return chosen === 'api_key' || settings.claudeProvider === 'anthropic-api'
    ? 'anthropic-api'
    : 'claude-code'
}

export { connectionText }

export function expectedSeconds(
  step: { assistId: string } | { templateKind: string },
  databases: readonly SqliteDatabase[],
  fallbackSeconds: number
): number {
  const durations: number[] = []
  for (const db of databases) {
    try {
      durations.push(...recentDurations(db, step))
    } catch {
      // A database without llm_calls (an old file mid-upgrade) adds nothing.
    }
  }
  if (durations.length === 0) return Math.max(1, Math.round(fallbackSeconds))
  const sorted = [...durations].sort((left, right) => left - right)
  const middle = sorted[Math.floor(sorted.length / 2)] ?? fallbackSeconds * 1000
  return Math.max(1, Math.round(middle / 1000))
}

export function assistLabel(
  connection: 'claude-code' | 'anthropic-api' | 'codex',
  seconds: number
): AssistLabel {
  const text = connectionText(connection)
  return {
    connection,
    connectionText: text,
    expectedSeconds: seconds,
    text: `${text} · about ${seconds} s`
  }
}
