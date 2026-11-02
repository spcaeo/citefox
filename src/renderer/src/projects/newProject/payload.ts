import { defaultProjectClaudeSettings } from '@shared/domain'
import type {
  ApiKeyMetadata,
  CapRule,
  ProjectClaudeSettings,
  ProjectSearchSettings
} from '@shared/domain'
import type { CreateProjectRequest } from '@shared/ipc'

/** The New project form's search, copy, and Claude choices (FR-10.4, FR-11.4, FR-11.7). */
export interface NewProjectChoices {
  /** Project id, or '' for "Start blank (app defaults)". */
  copyFrom: string
  source: 'shared' | 'dedicated'
  /** Raw cap input. Blank means no cap. */
  cap: string
  capRule: CapRule
  dedicatedKeyId: string
  /** 'app_default', 'claude_code', or an Anthropic key id. */
  claude: string
}

export const INITIAL_CHOICES: NewProjectChoices = {
  copyFrom: '',
  source: 'shared',
  cap: '',
  capRule: 'pause',
  dedicatedKeyId: '',
  claude: 'app_default'
}

export const CAP_RULE_OPTIONS: readonly { value: CapRule; label: string; hint: string }[] = [
  { value: 'pause', label: 'Pause checks', hint: 'Until the cap resets next month' },
  { value: 'notify', label: 'Ask me', hint: 'Notify me and wait' },
  { value: 'allow_10', label: 'Allow 10% over', hint: 'A little room for this month' }
]

/** Parses the cap field. Blank is no cap; anything else must be a whole number. */
export function parseCap(
  raw: string
): { ok: true; cap: number | null } | { ok: false; error: string } {
  const text = raw.trim().replace(/,/g, '')
  if (text.length === 0) return { ok: true, cap: null }
  if (!/^\d+$/.test(text))
    return { ok: false, error: 'Enter the cap as a whole number of searches.' }
  const cap = Number(text)
  if (!Number.isSafeInteger(cap) || cap > 1_000_000_000) {
    return { ok: false, error: 'Enter a smaller cap.' }
  }
  return { ok: true, cap }
}

/** Claude connection choices: app default, the Claude Code login, and each Anthropic key. */
export function claudeOptions(keys: readonly ApiKeyMetadata[]): { value: string; label: string }[] {
  return [
    { value: 'app_default', label: 'App default (from Settings)' },
    { value: 'claude_code', label: 'Claude Code on this computer' },
    ...keys
      .filter((key) => key.provider === 'anthropic')
      .sort((a, b) => a.rotationOrder - b.rotationOrder)
      .map((key) => ({ value: key.id, label: `Anthropic API · ${key.name}` }))
  ]
}

export function claudeSettingsFor(choice: string): ProjectClaudeSettings {
  const base = defaultProjectClaudeSettings()
  if (choice === 'claude_code') return { ...base, connection: 'claude_code' }
  if (choice === 'app_default' || choice.length === 0) return base
  return { ...base, connection: 'api_key', keyId: choice }
}

/** SRS 5.3: a client project should use an API key, not the personal Claude Code login. */
export function clientUsesClaudeCode(clientName: string, claude: string): boolean {
  return clientName.trim().length > 0 && claude === 'claude_code'
}

/**
 * The optional `projects:create` fields. A field is sent only when the user chose
 * something other than the default, so a blank form creates the same project as before.
 */
export function createOptions(
  choices: NewProjectChoices
):
  | { ok: true; options: Pick<CreateProjectRequest, 'copySettingsFrom' | 'search' | 'claude'> }
  | { ok: false; error: string } {
  const options: Pick<CreateProjectRequest, 'copySettingsFrom' | 'search' | 'claude'> = {}
  if (choices.copyFrom) options.copySettingsFrom = choices.copyFrom
  if (choices.source === 'dedicated') {
    if (!choices.dedicatedKeyId) return { ok: false, error: 'Choose the dedicated SerpApi key.' }
    const search: ProjectSearchSettings = {
      source: 'dedicated',
      cap: null,
      capRule: choices.capRule,
      dedicatedKeyId: choices.dedicatedKeyId
    }
    options.search = search
  } else {
    const parsed = parseCap(choices.cap)
    if (!parsed.ok) return parsed
    if (parsed.cap !== null || choices.capRule !== 'pause') {
      options.search = {
        source: 'shared',
        cap: parsed.cap,
        capRule: choices.capRule,
        dedicatedKeyId: null
      }
    }
  }
  if (choices.claude !== 'app_default') options.claude = claudeSettingsFor(choices.claude)
  return { ok: true, options }
}
