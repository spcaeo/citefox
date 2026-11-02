import { API_KEY_HINT_LENGTH, type ConnectionState } from '@shared/domain'
import type { ApiKeyMetadata, KeyTestReason } from '@shared/domain'
import type { ApiKeyRecord } from '../storage/records'
import { monthKey } from '../scheduler/local-time'

/**
 * A key is near its effective limit at 80% of that limit, and still under it.
 * At or over the limit is a separate detail.
 */
const NEAR_CAP_NUMERATOR = 4
const NEAR_CAP_DENOMINATOR = 5

/** `YYYY-MM` for the usage ledger, in the computer's timezone (SERP-6). */
export function usageMonth(now: Date): string {
  return monthKey(now.getTime(), Intl.DateTimeFormat().resolvedOptions().timeZone)
}

/**
 * Bullets plus the stored hint. The hint is at most four characters.
 * An empty hint stays empty so a short secret is not shown (NFR-5).
 */
export function maskedKeyFromHint(hint: string): string {
  if (hint.length === 0) return ''
  return `${'•'.repeat(API_KEY_HINT_LENGTH)}${hint}`
}

/**
 * The limit `usedThisMonth` counts against.
 * When both a monthly cap and a plan allowance are set, the lower one wins.
 */
export function effectiveMonthlyLimit(
  monthlyCap: number | null,
  planLimit: number | null
): number | null {
  if (monthlyCap !== null && planLimit !== null) return Math.min(monthlyCap, planLimit)
  return monthlyCap ?? planLimit
}

export function describeKeyStatus(input: {
  state: ConnectionState
  lastReason: KeyTestReason | null
  monthlyCap: number | null
  planLimit: number | null
  usedThisMonth: number
  /** SerpApi's whole-account count against `planLimit`. CiteFox's count is not it. */
  planUsed?: number | null
}): { status: ConnectionState; statusDetail: string | null } {
  const status = input.state
  if (status === 'warning') return { status, statusDetail: reasonDetail(input.lastReason) }
  if (status !== 'ok') return { status, statusDetail: null }
  const limit = effectiveMonthlyLimit(input.monthlyCap, input.planLimit)
  if (limit === null) return { status, statusDetail: null }
  const planUsed = input.planUsed ?? null
  const plan = input.planLimit
  if (input.usedThisMonth >= limit || (planUsed !== null && plan !== null && planUsed >= plan)) {
    return { status, statusDetail: 'At cap' }
  }
  if (
    isNearCap(input.usedThisMonth, limit) ||
    (planUsed !== null && plan !== null && isNearCap(planUsed, plan))
  ) {
    return { status, statusDetail: 'Near cap' }
  }
  return { status, statusDetail: null }
}

/** IPC view of a stored key. `usedThisMonth` is the month's recorded searches. */
export function presentApiKey(record: ApiKeyRecord, usedThisMonth: number): ApiKeyMetadata {
  const planLimit = record.serpapiUsage?.planLimit ?? null
  const described = describeKeyStatus({
    state: record.state,
    lastReason: record.lastReason,
    monthlyCap: record.cap,
    planLimit,
    usedThisMonth,
    planUsed: record.serpapiUsage?.used ?? null
  })
  return {
    ...record,
    plan: record.plan ?? record.serpapiUsage?.plan ?? null,
    maskedKey: maskedKeyFromHint(record.hint),
    // Read-only copies. Callers change `on` and `cap`; these two cannot differ.
    enabled: record.on,
    monthlyCap: record.cap,
    planLimit,
    usedThisMonth,
    projectIds: record.projectIds,
    status: described.status,
    // cloro sells credits, not searches.
    statusDetail:
      record.provider === 'cloro' && described.statusDetail === 'Out of searches'
        ? 'Out of credits'
        : described.statusDetail
  }
}

function isNearCap(used: number, limit: number): boolean {
  if (limit <= 0 || used >= limit) return false
  return used * NEAR_CAP_DENOMINATOR >= limit * NEAR_CAP_NUMERATOR
}

function reasonDetail(reason: KeyTestReason | null): string {
  if (reason === 'rejected') return 'Auth failed'
  if (reason === 'rate_limited') return 'Rate limited'
  if (reason === 'out_of_searches') return 'Out of searches'
  if (reason === 'timeout') return 'Timed out'
  return 'Could not use this key'
}
