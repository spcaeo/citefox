import type { KeyTestReason } from '@shared/ipc'

/**
 * A key test whose only problem is that the plan has no searches left.
 * The key itself works. `reason` is null when the test is ok.
 */
export function isOutOfSearches(result: { reason: KeyTestReason | null } | null): boolean {
  return result?.reason === 'out_of_searches'
}
