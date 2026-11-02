import type { ApiKeyMetadata, ClaudeProvider } from '../domain'
import type {
  ClaudeCheckupResult,
  ClaudeStatus,
  PermissionCheck,
  PermissionItem,
  PermissionPlatform
} from '../ipc'

/**
 * A ready Claude Code checkup is trusted for this long. After that, an AI
 * action that has to work right now (Fill from my website) runs it again first.
 */
export const CLAUDE_CHECKUP_FRESH_MS = 6 * 60 * 60 * 1000

export interface ClaudeInputs {
  platform: PermissionPlatform
  /** ISO-8601 UTC. */
  now: string
  claudeProvider: ClaudeProvider
  /** Settings model id. Null is the provider default. */
  claudeModel: string | null
  checkup: ClaudeCheckupResult | null
  /** ISO-8601 UTC of `checkup`. */
  checkupAt: string | null
  keys: readonly ApiKeyMetadata[]
}

/** "claude-sonnet-4-5-20250929" → "Sonnet 4.5"; "opus" → "Opus"; anything else as given. */
export function friendlyModel(id: string | null | undefined): string | null {
  const raw = id?.trim() ?? ''
  if (raw.length === 0) return null
  const named = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,8})?(?:\[1m\])?$/i.exec(raw)
  if (named) {
    const family = capitalize(named[1] ?? '')
    const version = named[3] ? `${named[2]}.${named[3]}` : (named[2] ?? '')
    return `${family} ${version}`.trim()
  }
  if (/^[a-z]+$/i.test(raw)) return capitalize(raw)
  return raw
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

function isFresh(at: string | null, now: string): boolean {
  if (at === null) return false
  const age = Date.parse(now) - Date.parse(at)
  return Number.isFinite(age) && age >= 0 && age <= CLAUDE_CHECKUP_FRESH_MS
}

function anthropicKey(keys: readonly ApiKeyMetadata[]): ApiKeyMetadata | null {
  return keys.find((key) => key.provider === 'anthropic' && key.on) ?? null
}

/** The connection AI features use now, for the status chip. No secret, no account email. */
export function claudeStatus(input: ClaudeInputs): ClaudeStatus {
  const model = friendlyModel(input.checkup?.resolvedModel ?? input.claudeModel)
  if (input.claudeProvider === 'anthropic-api') {
    const key = anthropicKey(input.keys)
    const base = {
      connection: 'anthropic-api' as const,
      name: 'Anthropic API key',
      plan: null,
      model: friendlyModel(input.claudeModel),
      checkedAt: null,
      fresh: key?.state === 'ok'
    }
    if (key === null) {
      return {
        ...base,
        state: 'needs_setup',
        summary: 'no key',
        nextStep: 'Add an Anthropic API key in Connections, or switch back to Claude Code.'
      }
    }
    if (key.state === 'ok') return { ...base, state: 'ready', summary: 'connected', nextStep: null }
    if (key.state === 'unchecked') {
      return {
        ...base,
        state: 'unchecked',
        summary: 'not tested yet',
        nextStep: 'Test the key in Connections.'
      }
    }
    return {
      ...base,
      state: 'needs_setup',
      summary: 'key needs attention',
      nextStep: 'Check the Anthropic key in Connections and paste it again.'
    }
  }
  const codex = input.claudeProvider === 'codex'
  const program = codex ? 'Codex' : 'Claude Code'
  // A checkup of the other program says nothing about this one.
  const checkup = sameProgram(input.checkup, codex) ? input.checkup : null
  const base = {
    connection: codex ? ('codex' as const) : ('claude-code' as const),
    name: program,
    plan: checkup?.plan ?? null,
    model: codex ? (checkup?.resolvedModel ?? null) : model,
    checkedAt: checkup ? input.checkupAt : null,
    fresh: checkup !== null && checkup.ready && isFresh(input.checkupAt, input.now)
  }
  if (checkup === null) {
    return {
      ...base,
      state: 'unchecked',
      summary: 'not checked yet',
      nextStep: `Check ${program} before the first AI step.`
    }
  }
  if (checkup.ready) return { ...base, state: 'ready', summary: 'connected', nextStep: null }
  return {
    ...base,
    state: 'needs_setup',
    summary: claudeProblem(checkup),
    nextStep: checkup.nextStep ?? checkup.message
  }
}

function sameProgram(checkup: ClaudeCheckupResult | null, codex: boolean): boolean {
  if (checkup === null) return false
  return (checkup.provider === 'codex') === codex
}

/** Short words for what stops Claude Code or Codex. */
export function claudeProblem(checkup: ClaudeCheckupResult): string {
  if (checkup.rows.binary.state === 'warning') return 'not found'
  if (checkup.login === 'logged_out') return 'not signed in'
  if (checkup.login === 'api_key') return 'signed in with an API key only'
  if (checkup.rows.login.state === 'warning') return 'not signed in'
  if (checkup.roundTrip === 'failed' || checkup.rows.roundTrip.state === 'warning') {
    return 'test call failed'
  }
  return 'needs a step'
}

function checksFrom(checkup: ClaudeCheckupResult | null, program: string): PermissionCheck[] {
  const rows: { label: string; key: 'binary' | 'login' | 'roundTrip' }[] = [
    { label: `${program} found`, key: 'binary' },
    { label: 'Signed in', key: 'login' },
    { label: 'Test call', key: 'roundTrip' }
  ]
  return rows.map(({ label, key }) => {
    const row = checkup?.rows[key]
    if (!row) return { label, state: 'pending', detail: 'Not checked yet' }
    return { label, state: row.state, detail: row.detail }
  })
}

/** The checklist row for the AI: Claude Code's or Codex's three checks, or the Anthropic key. */
export function claudeItem(input: ClaudeInputs): PermissionItem {
  const status = claudeStatus(input)
  const purpose =
    'Writes buyer profiles, buyer prompts, gap analysis and every AI suggestion. Uses no searches.'
  if (status.connection === 'anthropic-api') {
    const key = anthropicKey(input.keys)
    return {
      id: 'claude',
      title: 'Claude · Anthropic API key',
      purpose,
      need: 'required',
      state:
        status.state === 'ready' ? 'ok' : status.state === 'unchecked' ? 'unchecked' : 'action',
      statusLabel:
        status.state === 'ready'
          ? `Key works${key?.hint ? ` · ends ${key.hint}` : ''}`
          : capitalize(status.summary),
      detail: status.nextStep,
      checks: [],
      osPrompt: null,
      action: status.state === 'ready' ? null : { kind: 'setup', label: 'Set up Claude' }
    }
  }
  const codex = status.connection === 'codex'
  const program = status.name
  const checkup = sameProgram(input.checkup, codex) ? input.checkup : null
  const ready = status.state === 'ready'
  const extras = [checkup?.version ? `${program} ${checkup.version}` : null, status.model]
  return {
    id: 'claude',
    title: program,
    purpose,
    need: 'required',
    state: ready ? 'ok' : status.state === 'unchecked' ? 'unchecked' : 'action',
    statusLabel: ready
      ? ['Connected', status.plan].filter(Boolean).join(' · ')
      : capitalize(status.summary),
    detail: ready ? extras.filter(Boolean).join(' · ') || null : status.nextStep,
    checks: checksFrom(checkup, program),
    osPrompt:
      input.platform === 'darwin' && !codex
        ? 'CiteFox shows no system prompt for this. If macOS asks about “Claude Code-credentials”, that is Claude Code reading its own login: choose Always Allow.'
        : null,
    action: ready
      ? { kind: 'request', label: 'Check again' }
      : status.state === 'unchecked'
        ? { kind: 'request', label: `Check ${program}` }
        : { kind: 'setup', label: codex ? 'Set up Codex' : 'Set up Claude' }
  }
}
