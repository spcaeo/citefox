import { serpKeyAllowance, type ApiKeyMetadata } from '@shared/domain'

/** Credits left on every cloro key that is on, from each key's last balance read. */
export function cloroCreditsLeft(keys: readonly ApiKeyMetadata[]): number | null {
  const read = keys.filter((key) => key.provider === 'cloro' && key.on && key.cloroCredits)
  if (read.length === 0) return null
  return read.reduce((sum, key) => sum + (key.cloroCredits?.remaining ?? 0), 0)
}

/** SerpApi searches left this month on every key that is on and has a known allowance. */
export function serpSearchesLeft(keys: readonly ApiKeyMetadata[]): number | null {
  let left: number | null = null
  for (const key of keys) {
    if (key.provider !== 'serpapi' || !key.on) continue
    const allowance = serpKeyAllowance(key)
    if (allowance === null) continue
    left = (left ?? 0) + allowance.left
  }
  return left
}
