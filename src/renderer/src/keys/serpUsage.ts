import { serpKeyAllowance, type ApiKeyMetadata } from '@shared/domain'
import type { DrillScope, ItemDrill } from '../drill/types'
import { sectionHash } from '../shell/routes'
import { connectionStateLabel, projectsLabel } from './health'

/**
 * SerpApi usage, one rule for every screen (Status, the status popover,
 * Settings), shared with main through `serpKeyAllowance`: a key counts when it
 * is on, tested, and has a plan allowance or a cap. With a CiteFox cap, its
 * used/limit are CiteFox's own count of that cap (a SerpApi key is often shared
 * with other tools, so SerpApi's count is the whole account's). With no cap they
 * are the SerpApi plan's. Searches left is the tighter of the two remainders.
 * Summing the counted keys gives the capsule's `searchesLeft`
 * (`searchesLeft` in src/main/connection-status.ts). The plan's own figure is
 * shown separately (`plan`).
 */

/** A drawer scope for app-wide lists that belong to no page, market or check. */
export const APP_SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: '',
  brand: '',
  domain: ''
}

/** A SerpApi key line: SerpApi's count against the tighter of plan and cap. */
export interface SerpKeyLine {
  id: string
  name: string
  plan: string | null
  on: boolean
  /** Dedicated to named projects rather than shared. */
  dedicated: boolean
  used: number | null
  limit: number | null
  /** Same rule as the capsule's searches left. Null when the key does not count. */
  left: number | null
  /** CiteFox's own count this calendar month (SERP-6). */
  counted: number | null
  /** The SerpApi plan's figure (whole account), when a test reported it. */
  planUsed: number | null
  planLimit: number | null
}

/** Searches used, limit and left over every counted SerpApi key. */
export interface SerpUsageSummary {
  used: number
  limit: number
  left: number
  /** Keys in the sum. */
  counted: number
  /** Every SerpApi key, counted or not. */
  keys: number
  /** True when every counted key has a CiteFox cap, so used/limit are CiteFox's count. */
  citefoxOnly: boolean
  /** True when no counted key has a CiteFox cap, so used/limit are the SerpApi accounts'. */
  accountOnly: boolean
  /**
   * The SerpApi plans' own figure (whole accounts, other tools included), summed over the
   * counted keys that report it. Null when none does or it equals used/limit already.
   */
  plan: { used: number; limit: number } | null
}

/** The limit shown for a key: its CiteFox cap, else its plan allowance. */
function keyLimit(key: ApiKeyMetadata): number | null {
  return serpKeyAllowance(key)?.limit ?? null
}

/** True when the key is part of the capsule's searches left. */
export function keyCounts(key: ApiKeyMetadata): boolean {
  return key.provider === 'serpapi' && key.on && key.state !== 'unchecked' && keyLimit(key) !== null
}

/**
 * Searches left for one key, with the rule main uses for the capsule.
 * Null when the key does not count (off, not tested, or no limit known).
 */
export function keySearchesLeft(key: ApiKeyMetadata): number | null {
  if (!keyCounts(key)) return null
  return serpKeyAllowance(key)?.left ?? null
}

/** Used for a key: CiteFox's count of its cap, else the plan's count. */
function keyUsed(key: ApiKeyMetadata): number | null {
  const allowance = serpKeyAllowance(key)
  if (allowance !== null) return allowance.used
  return key.serpapiUsage?.used ?? null
}

/** SerpApi keys in rotation order. */
export function serpKeys(keys: readonly ApiKeyMetadata[]): ApiKeyMetadata[] {
  return keys
    .filter((key) => key.provider === 'serpapi')
    .slice()
    .sort((a, b) => a.rotationOrder - b.rotationOrder)
}

export function serpKeyLines(keys: readonly ApiKeyMetadata[]): SerpKeyLine[] {
  return serpKeys(keys).map((key) => ({
    id: key.id,
    name: key.name,
    plan: key.plan ?? key.serpapiUsage?.plan ?? null,
    on: key.on,
    dedicated: key.projectIds.length > 0,
    used: keyUsed(key),
    limit: keyLimit(key),
    left: keySearchesLeft(key),
    counted: key.usedThisMonth ?? null,
    planUsed: key.serpapiUsage?.used ?? null,
    planLimit: key.serpapiUsage?.planLimit ?? key.planLimit ?? null
  }))
}

/** Shared keys total: used of limit, summed over enabled shared keys that report both. */
export function sharedTotals(
  lines: readonly SerpKeyLine[]
): { used: number; limit: number } | null {
  const shared = lines.filter(
    (line) => line.on && !line.dedicated && line.used !== null && line.limit !== null
  )
  if (shared.length === 0) return null
  return {
    used: shared.reduce((sum, line) => sum + (line.used ?? 0), 0),
    limit: shared.reduce((sum, line) => sum + (line.limit ?? 0), 0)
  }
}

/**
 * Used, limit and left over every counted key. Null when no key counts, the
 * same case in which the capsule's `searchesLeft` is null.
 */
export function serpUsageSummary(keys: readonly ApiKeyMetadata[]): SerpUsageSummary | null {
  const all = serpKeys(keys)
  const counted = all.filter(keyCounts)
  if (counted.length === 0) return null
  const allowances = counted.map((key) => serpKeyAllowance(key))
  const capped = allowances.filter((allowance) => allowance?.basis === 'cap')
  const plans = allowances
    .map((allowance) => allowance?.plan ?? null)
    .filter((plan): plan is { used: number; limit: number } => plan !== null && plan.limit !== null)
  return {
    used: allowances.reduce((sum, allowance) => sum + (allowance?.used ?? 0), 0),
    limit: allowances.reduce((sum, allowance) => sum + (allowance?.limit ?? 0), 0),
    left: allowances.reduce((sum, allowance) => sum + (allowance?.left ?? 0), 0),
    counted: counted.length,
    keys: all.length,
    citefoxOnly: capped.length === counted.length,
    accountOnly: capped.length === 0,
    plan:
      capped.length === 0 || plans.length === 0
        ? null
        : {
            used: plans.reduce((sum, plan) => sum + plan.used, 0),
            limit: plans.reduce((sum, plan) => sum + plan.limit, 0)
          }
  }
}

/**
 * The two search numbers CiteFox shows, each always with its label:
 * - "Used by CiteFox this month": CiteFox's own count of the searches it ran.
 * - "SerpApi account": what SerpApi reports for the whole account, other apps included.
 * Searches left always come from the account limits (and a CiteFox cap when one is lower).
 */
export const CITEFOX_USED_LABEL = 'Used by CiteFox this month'

/**
 * "52 of 60 searches used by CiteFox this month" (every key capped), "40 of 250 used on
 * the SerpApi account this month (all apps)" (no cap), or the mixed wording.
 */
export function usageNoun(summary: Pick<SerpUsageSummary, 'citefoxOnly' | 'accountOnly'>): string {
  if (summary.citefoxOnly) return 'searches used by CiteFox this month'
  if (summary.accountOnly) return 'used on the SerpApi account this month (all apps)'
  return 'searches used this month (CiteFox caps and SerpApi accounts)'
}

/** The label above the summed figure, matching {@link usageNoun}. */
export function usageLabel(summary: Pick<SerpUsageSummary, 'citefoxOnly' | 'accountOnly'>): string {
  if (summary.citefoxOnly) return CITEFOX_USED_LABEL
  if (summary.accountOnly) return 'SerpApi account this month (all apps)'
  return 'Used this month (caps and accounts)'
}

/** "SerpApi plan: 161,522 of 250,000 used this month, other tools included", or null. */
export function planLine(summary: Pick<SerpUsageSummary, 'plan'>): string | null {
  if (summary.plan === null) return null
  return `SerpApi plan: ${formatCount(summary.plan.used)} of ${formatCount(summary.plan.limit)} used this month, other tools on the key included`
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/** Why a key is left out of the sum, in plain words. */
function notCountedReason(key: ApiKeyMetadata): string {
  if (!key.on) return 'Off, so not counted'
  if (key.state === 'unchecked') return 'Not tested yet, so not counted'
  return 'No plan or cap known, so not counted'
}

/**
 * One row per SerpApi key: used, limit and left this month. The counted
 * rows' "Left" column adds up to the capsule's searches left and their
 * "Used" column to the used total, so the drawer matches the number clicked.
 * Each row opens Connections, where the key is edited.
 */
export function serpKeysDrill(
  keys: readonly ApiKeyMetadata[],
  options: { id?: string; title?: string } = {}
): ItemDrill {
  const all = serpKeys(keys)
  const summary = serpUsageSummary(keys)
  const totals = summary
    ? `${formatCount(summary.used)} of ${formatCount(summary.limit)} used · ${formatCount(summary.left)} left`
    : 'No key reports a limit yet'
  return {
    kind: 'items',
    id: options.id ?? 'serp:keys',
    title: `${options.title ?? 'SerpApi keys'} · ${totals}`,
    omitCount: true,
    description:
      'Every SerpApi key, in the order CiteFox uses them. With a CiteFox cap, Used is CiteFox’s own count against that cap; without one, it is the SerpApi plan’s count. Left is the tighter of the two. Only counted keys add up to the totals.',
    noun: ['key', 'keys'],
    primaryLabel: 'Key',
    columns: [
      { id: 'used', label: 'Used', align: 'end', width: '84px' },
      { id: 'limit', label: 'Limit', align: 'end', width: '84px' },
      { id: 'left', label: 'Left', align: 'end', width: '84px' },
      { id: 'state', label: 'Status', width: '96px' }
    ],
    items: all.map((key) => {
      const counts = keyCounts(key)
      const used = keyUsed(key)
      const limit = keyLimit(key)
      const parts = [
        key.projectIds.length > 0 ? `Client key · ${projectsLabel(key.projectIds)}` : 'Shared',
        key.plan ?? key.serpapiUsage?.plan ?? null,
        key.cap !== null && key.serpapiUsage
          ? `SerpApi plan ${formatCount(key.serpapiUsage.used)}${key.serpapiUsage.planLimit === null ? '' : ` of ${formatCount(key.serpapiUsage.planLimit)}`}`
          : null,
        counts ? null : notCountedReason(key),
        key.statusDetail ?? null
      ].filter((part): part is string => Boolean(part))
      return {
        id: key.id,
        primary: key.name,
        secondary: parts.join(' · '),
        target: { kind: 'hash', hash: sectionHash('connections') },
        cells: {
          used: used === null ? '—' : formatCount(used),
          limit: limit === null ? '—' : formatCount(limit),
          left: counts ? formatCount(keySearchesLeft(key) ?? 0) : '—',
          state: connectionStateLabel(key.on ? key.state : 'off')
        },
        group: counts ? 'counted' : 'not_counted'
      }
    }),
    summary: [
      { label: 'Counted', group: 'counted' },
      { label: 'Not counted', group: 'not_counted' }
    ],
    note: 'Select a key to manage it in Connections.',
    scope: APP_SCOPE
  }
}
