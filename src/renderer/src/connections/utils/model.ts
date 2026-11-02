import type {
  ApiKeyMetadata,
  ApiKeyProvider,
  ClaudeFallback,
  ProjectClaudeConnection,
  ProjectClaudeSettings,
  SerpApiRotationMode
} from '@shared/domain'
import { serpKeyAllowance } from '@shared/domain'
import { formatStoredKeyHint } from '../../onboarding/hint'
import { errorText, GENERIC_ERROR } from '../../components/errorText'

/** FR-11.2. Labels for the rotation select, in mock-up order. */
export const ROTATION_OPTIONS: readonly { value: SerpApiRotationMode; label: string }[] = [
  {
    value: 'in_order',
    label: 'In order: use each key up to its own cap, then the next (recommended)'
  },
  { value: 'spread_evenly', label: 'Spread evenly: rotate keys on every search' },
  { value: 'project_keys', label: 'Only the keys assigned to each project' }
]

export const SORT_NOTE =
  'Sorting changes this view only. CiteFox rotates keys in Order-column order.'

export type KeySortColumn = 'order' | 'name' | 'used' | 'status'

export interface KeySort {
  column: KeySortColumn
  dir: 'asc' | 'desc'
}

/** One provider's keys in rotation order (the Order column, FR-11.2). */
export function keysInRotation(
  keys: readonly ApiKeyMetadata[],
  provider: ApiKeyProvider
): ApiKeyMetadata[] {
  return keys
    .filter((key) => key.provider === provider)
    .sort((a, b) => a.rotationOrder - b.rotationOrder || (a.id < b.id ? -1 : 1))
}

/**
 * Searches this month on a key (`serpKeyAllowance`, the same rule as Status): with a
 * CiteFox cap, CiteFox's own count; otherwise the SerpApi plan's count, which can
 * include other tools on the same account.
 */
export function usedOf(key: ApiKeyMetadata): number {
  return serpKeyAllowance(key)?.used ?? key.usedThisMonth ?? 0
}

/** The CiteFox cap, else the plan allowance, or null when neither is set. */
export function limitOf(key: ApiKeyMetadata): number | null {
  return serpKeyAllowance(key)?.limit ?? null
}

/** Plain status words for the Status column. */
export function statusWords(key: ApiKeyMetadata): string {
  if (!key.on) return 'Off'
  if (key.state === 'warning') return key.statusDetail ?? 'Needs attention'
  if (key.state === 'unchecked') return 'Not tested'
  if (key.state === 'off') return 'Off'
  return key.statusDetail ?? 'Works'
}

export function statusTone(key: ApiKeyMetadata): 'ok' | 'warning' | 'off' | 'unchecked' {
  if (!key.on || key.state === 'off') return 'off'
  return key.state
}

const STATUS_RANK: Readonly<Record<string, number>> = { ok: 0, unchecked: 1, warning: 2, off: 3 }

/**
 * The view order. Null sort is rotation order. Sorting never changes the
 * rotation order the engine uses (FR-11.2).
 */
export function sortedView(
  keys: readonly ApiKeyMetadata[],
  sort: KeySort | null
): ApiKeyMetadata[] {
  const rotation = [...keys].sort(
    (a, b) => a.rotationOrder - b.rotationOrder || (a.id < b.id ? -1 : 1)
  )
  if (sort === null) return rotation
  const sign = sort.dir === 'asc' ? 1 : -1
  const value = (key: ApiKeyMetadata): number | string => {
    if (sort.column === 'name') return key.name.toLowerCase()
    if (sort.column === 'used') return usedOf(key)
    if (sort.column === 'status') return STATUS_RANK[statusTone(key)] ?? 9
    return key.rotationOrder
  }
  return rotation.sort((a, b) => {
    const left = value(a)
    const right = value(b)
    if (left < right) return -1 * sign
    if (left > right) return 1 * sign
    return 0
  })
}

/** Next sort after a header click: ascending, then descending, then back to rotation. */
export function nextSort(current: KeySort | null, column: KeySortColumn): KeySort | null {
  if (current === null || current.column !== column) return { column, dir: 'asc' }
  if (current.dir === 'asc') return { column, dir: 'desc' }
  return null
}

/** The provider's full id list with one key moved up or down, for `keys:reorder`. */
export function movedIds(
  keys: readonly ApiKeyMetadata[],
  id: string,
  direction: -1 | 1
): string[] | null {
  const ids = [...keys]
    .sort((a, b) => a.rotationOrder - b.rotationOrder || (a.id < b.id ? -1 : 1))
    .map((key) => key.id)
  const index = ids.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return null
  const swap = ids[target]
  if (swap === undefined) return null
  ids[target] = id
  ids[index] = swap
  return ids
}

/**
 * The SerpApi section's totals in one plain sentence after the key count (FR-11.1):
 * "1 key. CiteFox used 20 of 250,000 capped searches this month." or "1 key. The
 * SerpApi account used 40 of 250 searches this month, other tools included." The same
 * two labelled numbers as Status, the status popover and Settings.
 */
export function serpTotalsLine(keys: readonly ApiKeyMetadata[]): string {
  if (keys.length === 0) return 'No key yet.'
  const count = keys.length === 1 ? '1 key.' : `${keys.length.toLocaleString('en-US')} keys.`
  const used = keys.reduce((sum, key) => sum + usedOf(key), 0)
  const limits = keys.filter((key) => key.on).map(limitOf)
  const total =
    limits.length > 0 && limits.every((limit) => limit !== null)
      ? limits.reduce<number>((sum, limit) => sum + (limit ?? 0), 0)
      : null
  const capped = keys.filter((key) => key.cap !== null).length
  const figure =
    total === null
      ? used.toLocaleString('en-US')
      : `${used.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`
  const sentence =
    capped === keys.length
      ? `CiteFox used ${figure} capped searches this month.`
      : capped === 0
        ? `The SerpApi ${keys.length === 1 ? 'account' : 'accounts'} used ${figure} searches this month, other tools included.`
        : `${figure} searches used this month, by CiteFox caps and SerpApi accounts.`
  return `${count} ${sentence}`
}

/** "1,240 of 5,000" or "1,240 · no limit". A cloro key: what CiteFox used, "12 by CiteFox". */
export function usedLine(key: ApiKeyMetadata): string {
  if (key.provider === 'cloro') return `${usedOf(key).toLocaleString('en-US')} by CiteFox`
  const limit = limitOf(key)
  const used = usedOf(key).toLocaleString('en-US')
  return limit === null ? `${used} · no limit` : `${used} of ${limit.toLocaleString('en-US')}`
}

/**
 * The provider account's own figure, under CiteFox's in the Used column, so a status
 * such as "Near cap" explains itself: "Account 218,102 of 250,000" (a capped SerpApi
 * key: the whole account's searches against its plan), "Whole account, all tools" (no
 * cap: the line above is already the account's), "Account 1,230 of 37,500 credits left"
 * (cloro, at the last test). Null when no test has reported it.
 */
export function accountLine(key: ApiKeyMetadata): string | null {
  if (key.provider === 'cloro') {
    const credits = key.cloroCredits ?? null
    if (credits === null) return null
    const left = credits.remaining.toLocaleString('en-US')
    return credits.perCycle === null
      ? `Account ${left} credits left`
      : `Account ${left} of ${credits.perCycle.toLocaleString('en-US')} credits left`
  }
  const allowance = serpKeyAllowance(key)
  const plan = allowance?.plan ?? null
  if (plan === null) return null
  if (allowance?.basis === 'plan') return 'Whole account, all tools'
  const used = plan.used.toLocaleString('en-US')
  return plan.limit === null
    ? `Account ${used} used`
    : `Account ${used} of ${plan.limit.toLocaleString('en-US')}`
}

/**
 * Why a status reads as it does, for its tooltip and accessible name: "Account near its
 * plan: 218,102 of 250,000 searches used, other tools included." when the SerpApi
 * account is the tighter figure, "CiteFox near its cap: 230 of 250 searches." when the
 * cap is, and a cloro key's balance. Null when the status needs no reason.
 */
export function statusWhy(key: ApiKeyMetadata): string | null {
  if (key.provider === 'cloro') {
    const credits = key.cloroCredits ?? null
    if (credits === null || !key.on) return null
    const left = credits.remaining.toLocaleString('en-US')
    return credits.perCycle === null
      ? `Account balance: ${left} credits left at the last test.`
      : `Account balance: ${left} of ${credits.perCycle.toLocaleString('en-US')} credits left at the last test.`
  }
  const words = statusWords(key)
  if (words !== 'Near cap' && words !== 'At cap') return null
  const where = words === 'At cap' ? 'at' : 'near'
  const plan = key.serpapiUsage ?? null
  const planShare =
    plan !== null && plan.planLimit !== null && plan.planLimit > 0 ? plan.used / plan.planLimit : -1
  const capUsed = key.usedThisMonth ?? 0
  const capShare = key.cap !== null && key.cap > 0 ? capUsed / key.cap : -1
  if (plan !== null && plan.planLimit !== null && planShare >= capShare) {
    return `Account ${where} its plan: ${plan.used.toLocaleString('en-US')} of ${plan.planLimit.toLocaleString('en-US')} searches used, other tools included.`
  }
  if (key.cap !== null) {
    return `CiteFox ${where} its cap: ${capUsed.toLocaleString('en-US')} of ${key.cap.toLocaleString('en-US')} searches.`
  }
  return null
}

export function usedPercent(key: ApiKeyMetadata): number {
  const limit = limitOf(key)
  if (limit === null || limit <= 0) return 0
  return Math.min(100, Math.round((usedOf(key) / limit) * 100))
}

export function maskOf(key: ApiKeyMetadata): string {
  return key.maskedKey && key.maskedKey.length > 0
    ? key.maskedKey
    : (formatStoredKeyHint(key.hint) ?? 'Saved in the keychain')
}

/** The user plan, else SerpApi's plan name, else null. A cloro balance shows in the Used column. */
export function planOf(key: ApiKeyMetadata): string | null {
  if (key.provider === 'cloro') return key.plan ?? null
  return key.plan ?? key.serpapiUsage?.plan ?? null
}

export interface ProjectRef {
  id: string
  name: string
}

/** Known project ids only. A removed project's id is dropped before saving. */
export function knownProjectIds(ids: readonly string[], projects: readonly ProjectRef[]): string[] {
  return ids.filter((id) => projects.some((project) => project.id === id))
}

/** "All projects", the project names, or "No project" when only removed projects remain. */
export function servesLabel(ids: readonly string[], projects: readonly ProjectRef[]): string {
  if (ids.length === 0) return 'All projects'
  const names = ids
    .map((id) => projects.find((project) => project.id === id)?.name)
    .filter((name): name is string => name !== undefined)
  return names.length === 0 ? 'No project' : names.join(', ')
}

export interface ChoiceOption {
  value: string
  label: string
}

/** The connection select for a project (FR-11.7). Value `key:<id>` is an API key. */
export function connectionOptions(anthropic: readonly ApiKeyMetadata[]): ChoiceOption[] {
  return [
    { value: 'app_default', label: 'App default (Settings)' },
    { value: 'claude_code', label: 'Claude Code on this computer' },
    ...anthropic.map((key) => ({ value: `key:${key.id}`, label: `Anthropic API · ${key.name}` }))
  ]
}

/** The fallback select. Switch options name every API key other than the chosen one. */
export function fallbackOptions(
  anthropic: readonly ApiKeyMetadata[],
  claude: ProjectClaudeSettings
): ChoiceOption[] {
  const chosen = claude.connection === 'api_key' ? claude.keyId : null
  return [
    { value: 'wait', label: 'Wait for the plan limit to reset' },
    ...anthropic
      .filter((key) => key.id !== chosen)
      .map((key) => ({
        value: `switch:${key.id}`,
        label: `Switch to Anthropic API · ${key.name}`
      })),
    { value: 'retry_later', label: 'Retry later' },
    { value: 'ask', label: 'Ask me' }
  ]
}

export function connectionValue(claude: ProjectClaudeSettings): string {
  return claude.connection === 'api_key' && claude.keyId !== null
    ? `key:${claude.keyId}`
    : claude.connection
}

export function fallbackValue(claude: ProjectClaudeSettings): string {
  return claude.fallback === 'switch_key' && claude.fallbackKeyId !== null
    ? `switch:${claude.fallbackKeyId}`
    : claude.fallback
}

/** Applies a connection select value. A fallback key equal to the new key falls back to wait. */
export function withConnection(
  claude: ProjectClaudeSettings,
  value: string
): ProjectClaudeSettings {
  const keyId = value.startsWith('key:') ? value.slice(4) : null
  const connection: ProjectClaudeConnection =
    keyId !== null ? 'api_key' : value === 'claude_code' ? 'claude_code' : 'app_default'
  const next: ProjectClaudeSettings = { ...claude, connection, keyId }
  if (next.fallback === 'switch_key' && next.fallbackKeyId === keyId) {
    return { ...next, fallback: 'wait', fallbackKeyId: null }
  }
  return next
}

export function withFallback(claude: ProjectClaudeSettings, value: string): ProjectClaudeSettings {
  if (value.startsWith('switch:')) {
    return { ...claude, fallback: 'switch_key', fallbackKeyId: value.slice(7) }
  }
  const fallback: ClaudeFallback =
    value === 'retry_later' ? 'retry_later' : value === 'ask' ? 'ask' : 'wait'
  return { ...claude, fallback, fallbackKeyId: null }
}

/**
 * An IPC error without Electron's invoke wrapper or the `area:verb:` prefix.
 * A message that contains the secret just sent is replaced (NFR-5).
 */
export function plainError(error: unknown, secret = ''): string {
  return errorText(error, GENERIC_ERROR, { secret })
}

/** "214 SerpApi searches · 38 Claude calls · 9 Jina reads" pieces. */
export function activityCount(value: number): string {
  return value.toLocaleString('en-US')
}
