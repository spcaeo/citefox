import type { ListFilter } from './types'

/** One choice in a Filter ▾ group. */
export interface FilterChoice {
  value: string
  label: string
  /** How many rows it matches, shown at the end of its line. */
  count?: number
  /** Starts a sub-group of choices under a small label, such as "Topics". */
  groupLabel?: string
}

/** One filter in the Filter ▾ menu, such as Result or Change (caller-controlled). */
export interface FilterGroup {
  id: string
  /** The group's name, such as "Result". */
  label: string
  value: string
  /** The value that means "no filter", such as `all`. */
  resetValue: string
  choices: readonly FilterChoice[]
  onChange: (value: string) => void
}

/** How many groups are set away from their reset value. */
export function filtersActive(groups: readonly FilterGroup[]): number {
  return groups.filter((group) => group.value !== group.resetValue).length
}

/**
 * The segmented filter as a Filter ▾ group, for when the toolbar has no room
 * for it (audit2 #7). Its reset is the filter's `resetValue`, else its first option.
 */
export function segmentGroup(filter: ListFilter, id: string): FilterGroup {
  return {
    id,
    label: filter.label,
    value: filter.value,
    resetValue: filter.resetValue ?? filter.options[0]?.value ?? filter.value,
    choices: filter.options.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.count !== undefined ? { count: option.count } : {})
    })),
    onChange: filter.onChange
  }
}
