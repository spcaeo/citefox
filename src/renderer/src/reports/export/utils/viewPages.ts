import type { Market } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import { allPagesColumns } from '../../../allPages/utils/columns'
import { buildRowIndex, matchingIndices } from '../../../grid/model/rows'

/** The facet filters of a saved All pages view (`grid:listViews` state), or none. */
function viewFilters(state: unknown): Readonly<Record<string, readonly string[]>> {
  if (typeof state !== 'object' || state === null || !('filters' in state)) return {}
  const filters = (state as { filters: unknown }).filters
  if (typeof filters !== 'object' || filters === null) return {}
  const out: Record<string, readonly string[]> = {}
  for (const [key, values] of Object.entries(filters)) {
    if (Array.isArray(values)) out[key] = values.filter((value) => typeof value === 'string')
  }
  return out
}

/**
 * The pages a saved All pages view shows, worked out with All pages' own
 * columns and the grid's own filter pipeline (the same call `PagesGrid` makes),
 * so an export of "Money pages" holds exactly the rows the view lists.
 */
export function viewPageIds(
  rows: readonly AllPageRow[],
  markets: readonly Market[],
  state: unknown,
  now: Date = new Date()
): string[] {
  const columns = allPagesColumns({
    markets: new Map(markets.map((market) => [market.id, market])),
    hasClusters: rows.some((row) => (row.clusters?.length ?? 0) > 0),
    hasGroups: rows.some((row) => (row.groups?.length ?? 0) > 0),
    now,
    onDrill: () => undefined
  })
  const index = buildRowIndex(rows, undefined)
  return matchingIndices(
    index,
    { search: '', filters: viewFilters(state), ranges: {} },
    columns
  ).map((at) => (index.rows[at] as AllPageRow).id)
}
