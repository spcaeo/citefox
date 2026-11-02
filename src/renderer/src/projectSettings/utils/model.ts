import type {
  ApiKeyMetadata,
  CapRule,
  ClaudeFallback,
  ProjectClaudeSettings,
  ProjectSearchSettings
} from '@shared/domain'
import { serpKeyAllowance } from '@shared/domain'
import type { ProjectSearchUsage } from '@shared/ipc'
import { CAP_RULE_LABELS, CAP_RULE_ORDER, FALLBACK_LABELS } from '../constants'
import { errorText as plainErrorText } from '../../components/errorText'
import { formatClock, formatMoment } from '../../utils/dates'

/** IPC error text without Electron's wrapper or the `area:verb:` prefix. */
export function errorText(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  return plainErrorText(error, fallback, { sentence: true })
}

/** `example.com` from a pasted URL. */
export function cleanDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

/** Adds a name once, case-insensitively, trimmed. */
export function addUnique(list: readonly string[], value: string): string[] {
  const next = value.trim()
  if (next.length === 0) return [...list]
  if (list.some((item) => item.toLowerCase() === next.toLowerCase())) return [...list]
  return [...list, next]
}

/** `Nov 1` from `2026-11-01`. */
export function dayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

/** `Oct 31`: the last day before the reset. */
export function monthEndLabel(resetsOn: string): string {
  const [year, month, day] = resetsOn.split('-').map(Number)
  if (!year || !month || !day) return 'month end'
  const last = new Date(Date.UTC(year, month - 1, day) - 86_400_000)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(last)
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/** Cap plus 10%, the way the engine counts it (whole searches). */
export function allowanceFor(cap: number, rule: CapRule): number {
  return rule === 'allow_10' ? cap + Math.floor(cap / 10) : cap
}

export interface CapRuleOption {
  rule: CapRule
  label: string
  hint: string
}

/** FR-11.4 cap rule radios with the mock-up's hints. */
export function capRuleOptions(cap: number | null, resetsOn: string): CapRuleOption[] {
  const reset = dayLabel(resetsOn)
  return CAP_RULE_ORDER.map((rule) => ({
    rule,
    label: CAP_RULE_LABELS[rule],
    hint:
      rule === 'pause'
        ? `Until the cap resets on ${reset}`
        : rule === 'notify'
          ? 'Notify me and wait'
          : cap === null
            ? '10% more than the monthly cap'
            : `Up to ${formatCount(allowanceFor(cap, 'allow_10'))} this month`
  }))
}

/** "1,240 of 3,000", or "1,240 · no cap". */
export function usageLine(usage: ProjectSearchUsage): string {
  if (usage.allowance === null) return `${formatCount(usage.used)} · no cap`
  return `${formatCount(usage.used)} of ${formatCount(usage.allowance)}`
}

export function usagePercent(usage: ProjectSearchUsage): number {
  if (usage.allowance === null || usage.allowance <= 0) return 0
  return Math.min(100, Math.round((usage.used / usage.allowance) * 100))
}

/** "At this pace, about 2,020 by Oct 31." or null before the first search. */
export function paceLine(usage: ProjectSearchUsage): string | null {
  if (usage.projectedMonthEnd === null) return null
  return `At this pace, about ${formatCount(usage.projectedMonthEnd)} by ${monthEndLabel(usage.resetsOn)}.`
}

/** The CiteFox cap, else the SerpApi plan allowance (`serpKeyAllowance`). */
export function keyLimit(key: ApiKeyMetadata): number | null {
  return serpKeyAllowance(key)?.limit ?? null
}

/** "My plan · ••••4f2a · 1,240 of 5,000", the same figures as Status. */
export function keyOptionLabel(key: ApiKeyMetadata): string {
  const parts = [key.name]
  if (key.hint.length > 0) parts.push(`••••${key.hint}`)
  const used = serpKeyAllowance(key)?.used ?? key.usedThisMonth ?? 0
  const limit = keyLimit(key)
  parts.push(
    limit === null ? `${formatCount(used)} used` : `${formatCount(used)} of ${formatCount(limit)}`
  )
  return parts.join(' · ')
}

export function keysOf(
  keys: readonly ApiKeyMetadata[],
  provider: ApiKeyMetadata['provider']
): ApiKeyMetadata[] {
  return keys
    .filter((key) => key.provider === provider)
    .sort((a, b) => a.rotationOrder - b.rotationOrder)
}

/** Select value for a Claude connection: `app_default`, `claude_code`, or `api_key:<id>`. */
export function connectionValue(claude: ProjectClaudeSettings): string {
  return claude.connection === 'api_key' && claude.keyId !== null
    ? `api_key:${claude.keyId}`
    : claude.connection
}

/** Select value for a fallback: `wait`, `retry_later`, `ask`, or `switch_key:<id>`. */
export function fallbackValue(claude: ProjectClaudeSettings): string {
  return claude.fallback === 'switch_key' && claude.fallbackKeyId !== null
    ? `switch_key:${claude.fallbackKeyId}`
    : claude.fallback
}

export interface Option {
  value: string
  label: string
}

export function connectionOptions(anthropic: readonly ApiKeyMetadata[]): Option[] {
  return [
    { value: 'app_default', label: 'App default (Settings)' },
    { value: 'claude_code', label: 'Claude Code on this computer' },
    ...anthropic.map((key) => ({
      value: `api_key:${key.id}`,
      label: `Anthropic API · ${key.name}`
    }))
  ]
}

/** FR-11.7 fallbacks. Switching to the key the project already uses is not offered. */
export function fallbackOptions(
  anthropic: readonly ApiKeyMetadata[],
  connection: string
): Option[] {
  const chosen = connection.startsWith('api_key:') ? connection.slice('api_key:'.length) : null
  return [
    { value: 'wait', label: FALLBACK_LABELS.wait },
    ...anthropic
      .filter((key) => key.id !== chosen)
      .map((key) => ({
        value: `switch_key:${key.id}`,
        label: `Switch to Anthropic API · ${key.name}`
      })),
    { value: 'retry_later', label: FALLBACK_LABELS.retry_later },
    { value: 'ask', label: FALLBACK_LABELS.ask }
  ]
}

/** Builds the saved settings from the two select values and the model field. */
export function claudeFromForm(
  connection: string,
  fallback: string,
  model: string
): ProjectClaudeSettings {
  const keyId = connection.startsWith('api_key:') ? connection.slice('api_key:'.length) : null
  const fallbackKeyId = fallback.startsWith('switch_key:')
    ? fallback.slice('switch_key:'.length)
    : null
  const base = connection.startsWith('api_key:') ? 'api_key' : connection
  const rule = (fallback.startsWith('switch_key:') ? 'switch_key' : fallback) as ClaudeFallback
  const trimmed = model.trim()
  return {
    connection: base === 'claude_code' || base === 'api_key' ? base : 'app_default',
    keyId,
    fallback: fallbackKeyId === null && rule === 'switch_key' ? 'wait' : rule,
    fallbackKeyId: rule === 'switch_key' ? fallbackKeyId : null,
    model: trimmed.length === 0 ? null : trimmed
  }
}

/** SRS 5.3: a client project should not run on the Claude Code login. */
export function usesClaudeCode(
  connection: string,
  appProvider: 'claude-code' | 'anthropic-api' | 'codex' | null
): boolean {
  if (connection === 'claude_code') return true
  return connection === 'app_default' && appProvider === 'claude-code'
}

/** Parses the cap field. Blank is no cap. */
export function parseCap(value: string): { cap: number | null } | { error: string } {
  const text = value.trim().replace(/,/g, '')
  if (text.length === 0) return { cap: null }
  if (!/^\d+$/.test(text))
    return { error: 'Enter a whole number of searches, or leave it blank for no cap.' }
  const cap = Number(text)
  if (cap > 1_000_000_000) return { error: 'That cap is too large.' }
  return { cap }
}

/** The search settings the form describes. */
export function searchFromForm(
  source: ProjectSearchSettings['source'],
  cap: number | null,
  capRule: CapRule,
  dedicatedKeyId: string | null
): ProjectSearchSettings {
  return {
    source,
    cap,
    capRule,
    dedicatedKeyId: source === 'dedicated' ? dedicatedKeyId : null
  }
}

/** "41.6 MB", "820 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

/** `projects/example.sqlite` → `example.sqlite`. */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

/** Emails from a comma-separated field. */
export function splitEmails(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/**
 * "Today 9:00 AM", "Oct 21, 9:00 AM" (in the computer's own clock style), or the plain
 * words for none.
 */
export function nextCheckLabel(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'Nothing is scheduled yet'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Nothing is scheduled yet'
  if (date.toDateString() === now.toDateString()) return `Today ${formatClock(iso)}`
  return formatMoment(iso, { now })
}
