import type { ClaudeStatus } from '@shared/ipc'

export type ClaudeChipTone = 'ok' | 'warn' | 'neutral' | 'busy'

export interface ClaudeChipModel {
  tone: ClaudeChipTone
  /** Shown joined by " · ", such as Claude Code · connected · Claude Max · Sonnet 4.5. */
  parts: readonly string[]
  /** Screen-reader sentence. */
  label: string
}

/** "Claude" or "Codex": the AI the chip is about. */
function aiOf(status: ClaudeStatus | null): string {
  return status?.connection === 'codex' ? 'Codex' : 'Claude'
}

/** What the plain chip says for each state, with no provider, plan or model names. */
function plainState(status: ClaudeStatus | null, checking: boolean): string {
  if (checking) return 'checking…'
  if (status === null) return 'reading status…'
  if (status.state === 'ready') return 'connected'
  if (status.state === 'unchecked') return 'not checked'
  return 'needs a step'
}

function toneOf(status: ClaudeStatus | null, checking: boolean): ClaudeChipTone {
  if (checking) return 'busy'
  if (status === null || status.state === 'unchecked') return 'neutral'
  return status.state === 'ready' ? 'ok' : 'warn'
}

/**
 * Words and tone for the AI chip. Never a secret or an account email. Outside
 * Connections, Status and Permissions (`named` false) it says "CiteFox AI" and
 * the state only: users never see the provider, plan or model there.
 */
export function claudeChipModel(
  status: ClaudeStatus | null,
  checking: boolean,
  named = false
): ClaudeChipModel {
  if (!named) {
    const parts = ['CiteFox AI', plainState(status, checking)]
    return { tone: toneOf(status, checking), parts, label: `CiteFox AI: ${parts[1]}` }
  }
  const name = status?.name ?? 'Claude'
  let tone: ClaudeChipTone
  let parts: string[]
  if (checking) {
    tone = 'busy'
    parts = [
      status?.connection === 'claude-code' || status === null ? 'Claude Code' : name,
      'checking…'
    ]
  } else if (status === null) {
    tone = 'neutral'
    parts = ['Claude', 'reading status…']
  } else if (status.state === 'ready') {
    tone = 'ok'
    parts = [name, status.summary, status.plan, status.model].filter(
      (part): part is string => typeof part === 'string' && part.length > 0
    )
  } else {
    tone = status.state === 'unchecked' ? 'neutral' : 'warn'
    parts = [name, status.summary]
  }
  return { tone, parts, label: `${aiOf(status)} connection: ${parts.join(', ')}` }
}

/** The status capsule's short AI segment ("CiteFox AI connected"); the popover has the full line. */
export function claudeCapsuleText(status: ClaudeStatus | null, checking: boolean): string | null {
  const ai = 'CiteFox AI'
  if (checking) return `Checking ${ai}…`
  if (status === null) return null
  if (status.state === 'ready') return `${ai} connected`
  if (status.state === 'unchecked') return `${ai} not checked`
  return `${ai} needs a step`
}
