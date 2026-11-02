import type { AiCliProvider } from '@shared/domain'
import type { ClaudeCheckupProgress, ClaudeCheckupResult } from '@shared/ipc'

/**
 * The browser mock's checkup for Codex: the same scripted scenarios as Claude Code,
 * reworded for the Codex CLI, so the onboarding AI step can be tried with either.
 */
export function asProviderScript<
  T extends { events: readonly ClaudeCheckupProgress[]; result: ClaudeCheckupResult }
>(script: T, provider: AiCliProvider): T {
  if (provider !== 'codex') return script
  const reworded = JSON.parse(
    JSON.stringify(script)
      .replaceAll('/usr/local/bin/claude', '/usr/local/bin/codex')
      .replaceAll('run claude and log in', 'run codex login and sign in')
      .replaceAll('Claude Max', 'ChatGPT')
      .replaceAll('Claude Code', 'Codex')
      .replaceAll('Claude', 'Codex')
  ) as T
  return { ...reworded, result: { ...reworded.result, provider: 'codex' } }
}
