import { totalsOf, type Search } from '../model'

/**
 * True for a topic's first check with nothing cited yet: one finished check, at least
 * one search checked, and no own page in any answer.
 */
export function isQuietFirstCheck(searches: readonly Search[], fullChecks: number): boolean {
  const totals = totalsOf(searches)
  return (
    fullChecks <= 1 &&
    totals.searches - totals.counts.not_checked > 0 &&
    totals.counts.target + totals.counts.other_page === 0
  )
}
