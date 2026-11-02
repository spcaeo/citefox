import type { VerdictSet } from '../report/verdict'
import { changeOf, isAnswered, isCitedRow, isCompared, isNamedRow, isNotVisible } from './counts'
import type { MetricPair } from './types'

/**
 * The ids behind each verdict number (`shared/report/verdict.ts`), so Summary and the
 * offline report give the same numbers from the same rules. Every id is a `to` row's:
 * a verdict number opens the questions as they stand now.
 *
 * `pairs` holds every question now; a pair whose `from` is null (or failed) is not
 * compared. `topSite` is the most cited other site, as the rows' `domains` name it.
 */
export function verdictSetsOf(
  pairs: readonly MetricPair[],
  topSite: string | null
): Record<VerdictSet, string[]> {
  const sets: Record<VerdictSet, string[]> = {
    tracked: [],
    aio: [],
    cited: [],
    named: [],
    not_visible: [],
    cited_before: [],
    cited_after: [],
    named_before: [],
    named_after: [],
    gained: [],
    kept: [],
    lost: [],
    top_site: []
  }
  for (const pair of pairs) {
    const row = pair.to
    const id = row.id
    sets.tracked.push(id)
    if (isAnswered(row)) sets.aio.push(id)
    if (isCitedRow(row)) sets.cited.push(id)
    if (isNamedRow(row)) sets.named.push(id)
    if (isNotVisible(row)) sets.not_visible.push(id)
    if (topSite !== null && isAnswered(row) && row.domains.includes(topSite)) {
      sets.top_site.push(id)
    }
    if (!isCompared(pair)) continue
    const change = changeOf(pair)
    if (change === 'gained' || change === 'kept' || change === 'lost') sets[change].push(id)
    if (change === 'kept' || change === 'lost') sets.cited_before.push(id)
    if (change === 'kept' || change === 'gained') sets.cited_after.push(id)
    if (isNamedRow(pair.from)) sets.named_before.push(id)
    if (isNamedRow(row)) sets.named_after.push(id)
  }
  return sets
}
