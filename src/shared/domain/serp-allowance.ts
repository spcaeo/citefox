import type { ApiKeyMetadata } from './connections'

/**
 * One rule for a SerpApi key's month, used by main (the status capsule, key status)
 * and every screen (status popover, Status, Settings, Connections, Projects, Project
 * settings) so the numbers agree (NFR-14).
 *
 * A SerpApi key is often shared with other tools, so SerpApi's `this_month_usage` is the
 * whole account's traffic, not CiteFox's. Two figures are therefore kept apart:
 *
 * - CiteFox's budget (`cap`) is measured against CiteFox's own counted searches
 *   (`usedThisMonth`, from `key_usage`, SERP-6).
 * - The SerpApi plan (`serpapiUsage`) is the account's figure: used of the plan allowance.
 *
 * Searches left is the tighter of `cap - counted` and `planLimit - planUsed`.
 * With no cap, the plan is the only figure, so `used`/`limit` are the plan's.
 */
export interface SerpKeyAllowance {
  /** `cap`: used/limit are CiteFox's count of its budget. `plan`: they are the plan's. */
  basis: 'cap' | 'plan'
  used: number
  limit: number
  left: number
  /** The SerpApi plan's own figure (whole account), when a test reported it. */
  plan: { used: number; limit: number | null } | null
}

export type SerpAllowanceFields = Pick<ApiKeyMetadata, 'cap' | 'serpapiUsage'> & {
  usedThisMonth?: number
  planLimit?: number | null
}

export function serpKeyAllowance(key: SerpAllowanceFields): SerpKeyAllowance | null {
  const planUsed = key.serpapiUsage?.used ?? null
  const planLimit = key.serpapiUsage?.planLimit ?? key.planLimit ?? null
  const planLeft = planLimit === null ? null : Math.max(0, planLimit - (planUsed ?? 0))
  const plan = planUsed === null ? null : { used: planUsed, limit: planLimit }
  if (key.cap !== null) {
    const used = key.usedThisMonth ?? 0
    const capLeft = Math.max(0, key.cap - used)
    return {
      basis: 'cap',
      used,
      limit: key.cap,
      left: planLeft === null ? capLeft : Math.min(capLeft, planLeft),
      plan
    }
  }
  if (planLimit === null || planLeft === null) return null
  return { basis: 'plan', used: planUsed ?? 0, limit: planLimit, left: planLeft, plan }
}
