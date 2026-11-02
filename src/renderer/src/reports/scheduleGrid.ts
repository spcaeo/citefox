import { cycleSort, sortRows, type SortSpec } from '../m3/model'
import { pluralize } from '@shared/pluralize'

export interface GridFacet<T> {
  key: string
  label: string
  options: readonly string[]
  value: (item: T) => string
}

export type FacetSelection = Readonly<Record<string, readonly string[]>>

export const EMPTY_FACETS: FacetSelection = {}

export function toggleFacet(current: FacetSelection, key: string, option: string): FacetSelection {
  const selected = current[key] ?? []
  const next = selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected, option]
  return { ...current, [key]: next }
}

export function clearFacet(current: FacetSelection, key: string): FacetSelection {
  return { ...current, [key]: [] }
}

export function facetChips(
  facets: readonly { key: string; label: string }[],
  selected: FacetSelection
): { key: string; option: string; label: string }[] {
  const chips: { key: string; option: string; label: string }[] = []
  for (const facet of facets) {
    for (const option of selected[facet.key] ?? []) {
      chips.push({ key: facet.key, option, label: `${facet.label}: ${option}` })
    }
  }
  return chips
}

export function filterRows<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
  facets: readonly GridFacet<T>[],
  selected: FacetSelection
): T[] {
  const needle = query.trim().toLowerCase()
  return items.filter((item) => {
    if (needle && !text(item).toLowerCase().includes(needle)) return false
    return facets.every((facet) => {
      const picked = selected[facet.key] ?? []
      if (picked.length === 0) return true
      return picked.includes(facet.value(item))
    })
  })
}

/** Counts for one option after every other facet, and the search, have been applied. */
export function facetOptionCount<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
  facets: readonly GridFacet<T>[],
  selected: FacetSelection,
  key: string,
  option: string
): number {
  const without: FacetSelection = { ...selected, [key]: [] }
  return filterRows(items, query, text, facets, without).filter(
    (item) => facets.find((facet) => facet.key === key)?.value(item) === option
  ).length
}

/**
 * Sort, then (FR-23.11) put failed rows first when a search or facet is on
 * and the user has not sorted by the result column.
 */
export function orderRows<T>(
  items: readonly T[],
  sorts: readonly SortSpec<string>[],
  value: (item: T, key: string) => string | number | null,
  options?: {
    filtering: boolean
    failedFirst?: (item: T) => boolean
    resultKey?: string
  }
): T[] {
  const sorted = sortRows(items, sorts, value)
  if (!options?.filtering || !options.failedFirst) return sorted
  if (options.resultKey && sorts.some((sort) => sort.key === options.resultKey)) return sorted
  const failed: T[] = []
  const rest: T[] = []
  for (const item of sorted) {
    if (options.failedFirst(item)) failed.push(item)
    else rest.push(item)
  }
  return failed.concat(rest)
}

export function filtersOnLabel(count: number): string {
  return `${pluralize(count, 'filter')} on`
}

export function showingLine(
  shown: number,
  total: number,
  noun: string,
  plural: string,
  filtering: boolean
): string {
  const word = total === 1 ? noun : plural
  const base = `Showing ${shown} of ${total} ${word}`
  return filtering ? `${base} · filtered` : base
}

export function emptyLine(noun: string): string {
  return `No ${noun} match this search and these filters.`
}

export function catalogEmptyLine(plural: string): string {
  return `No ${plural} yet.`
}

export function isFiltering(query: string, selected: FacetSelection): boolean {
  if (query.trim() !== '') return true
  return Object.values(selected).some((options) => options.length > 0)
}

export { cycleSort }
export type { SortSpec }
