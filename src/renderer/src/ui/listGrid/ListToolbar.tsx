import { useMemo, useRef, type JSX, type ReactNode } from 'react'
import { Button } from '../Button'
import { Dropdown, type DropdownGroup, type DropdownOption } from '../Dropdown'
import { IconButton } from '../IconButton'
import { SegmentedControl } from '../SegmentedControl'
import { FilterMenu } from './FilterMenu'
import { segmentGroup, type FilterChoice, type FilterGroup } from './filters'
import type { ListFilter } from './types'
import { useToolbarFit } from './useToolbarFit'
import { SearchBox } from '../Tools'

/** The segmented filter's id among the filters that may move into Filter ▾. */
const SEGMENT_ID = 'ui-lg-segment'

/** A filter's choices as dropdown options: a choice with a `groupLabel` starts a group. */
function controlOptions(
  choices: readonly FilterChoice[]
): readonly (DropdownOption | DropdownGroup)[] {
  const out: (DropdownOption | { label: string; options: DropdownOption[] })[] = []
  let group: { label: string; options: DropdownOption[] } | null = null
  for (const choice of choices) {
    const option: DropdownOption = { value: choice.value, label: choice.label }
    if (choice.groupLabel) {
      group = { label: choice.groupLabel, options: [] }
      out.push(group)
    }
    if (group) group.options.push(option)
    else out.push(option)
  }
  return out
}

/**
 * The 56px toolbar: search, the engine filter, segmented filter, filter
 * dropdowns, Filter ▾, the clear icon (while anything is set), extra slot, then actions, Columns and the AI menu on
 * the right. The engine filter sits in the same spot on every results screen
 * (audit #4). When the row has no room, the filter dropdowns (last first) and
 * then the segmented filter move into Filter ▾ by themselves, so the row never
 * wraps (audit2 #7); search, the engine spot, the extra slot and the actions stay.
 */
export function ListToolbar({
  searchLabel,
  searchValue,
  onSearch,
  engine,
  filter,
  filters = [],
  controls = [],
  toolbar,
  actions,
  columns,
  ai,
  onReset
}: {
  /** Null: no search box. */
  searchLabel: string | null
  searchValue: string
  onSearch: (value: string) => void
  /** The engine filter's control (engines/ useEngineFilter), right after the search. */
  engine?: ReactNode
  filter: ListFilter | undefined
  /** The Filter ▾ menu's own groups (FilterMenu), after the segmented filter. */
  filters?: readonly FilterGroup[]
  /** Filters shown as their own dropdowns while the row has room. */
  controls?: readonly FilterGroup[]
  toolbar: ReactNode
  actions: ReactNode
  /** The shared Columns button, after the actions (R11). */
  columns?: ReactNode
  ai: ReactNode
  /** Present while a search or any filter is set: one icon clears them all. */
  onReset?: () => void
}): JSX.Element {
  const bar = useRef<HTMLDivElement | null>(null)
  const movable = useMemo(
    () => [...(filter && !filter.stay ? [SEGMENT_ID] : []), ...controls.map((group) => group.id)],
    [filter, controls]
  )
  const moved = useToolbarFit(bar, movable, filters.length > 0)
  const segmentMoved = filter !== undefined && moved.includes(SEGMENT_ID)
  // Moved filters join the menu in toolbar order, after its own groups; the
  // button's count then includes the moved ones that are set.
  const menuGroups = [
    ...filters,
    ...(segmentMoved ? [segmentGroup(filter, SEGMENT_ID)] : []),
    ...controls.filter((group) => moved.includes(group.id))
  ]
  return (
    <div ref={bar} className="ui-lg-bar">
      {searchLabel !== null ? (
        <SearchBox
          className="ui-lg-search"
          label={searchLabel}
          value={searchValue}
          onChange={onSearch}
        />
      ) : null}
      {engine}
      {filter && !segmentMoved ? (
        <span className="ui-lg-slot" data-lg-move={filter.stay ? undefined : SEGMENT_ID}>
          <SegmentedControl
            label={filter.label}
            options={filter.options}
            value={filter.value}
            onChange={filter.onChange}
          />
        </span>
      ) : null}
      {controls
        .filter((group) => !moved.includes(group.id))
        .map((group) => (
          <span key={group.id} className="ui-lg-slot" data-lg-move={group.id}>
            <Dropdown
              size="sm"
              prefix={group.label}
              aria-label={group.label}
              value={group.value}
              onChange={group.onChange}
              options={controlOptions(group.choices)}
            />
          </span>
        ))}
      {menuGroups.length > 0 ? (
        <span className="ui-lg-slot" data-lg-filter="">
          <FilterMenu groups={menuGroups} />
        </span>
      ) : null}
      {onReset ? (
        <IconButton
          icon="filter-x"
          size="sm"
          label="Clear filters and search"
          tip
          data-lg-clear=""
          onClick={onReset}
        />
      ) : null}
      {toolbar}
      <span className="ui-lg-spacer" />
      {actions}
      {columns}
      {ai}
    </div>
  )
}

/** The 56px fox-tint bulk bar that replaces the toolbar while rows are selected. */
export function ListBulkBar({
  selected,
  matching,
  noun,
  onSelectAll,
  onClear,
  children
}: {
  selected: number
  matching: number
  noun: readonly [string, string]
  /** Null when every matching row is already selected. */
  onSelectAll: (() => void) | null
  onClear: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div className="ui-lg-bulk" role="region" aria-label="Bulk actions">
      <span className="ui-lg-bulk-count num" role="status">
        {selected.toLocaleString('en-US')} selected
      </span>
      {/* The actions wrap among themselves; the count and Clear stay on the first line. */}
      <div className="ui-lg-bulk-actions">
        {children}
        {onSelectAll ? (
          <Button variant="text" className="ui-lg-bulk-all" onClick={onSelectAll}>
            Select all {matching.toLocaleString('en-US')} {matching === 1 ? noun[0] : noun[1]}
          </Button>
        ) : null}
      </div>
      <Button variant="ghost" size="sm" className="ui-lg-bulk-clear" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
