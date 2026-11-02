import type { JSX } from 'react'
import { MenuButton, type MenuItem } from '../Menu'
import { UiIcon } from '../UiIcon'
import { filtersActive, type FilterGroup } from './filters'

export type { FilterChoice, FilterGroup } from './filters'

/**
 * one "Filter" button: every filter of a list in one
 * menu, each a group of choices with a tick on the picked one, and "Clear
 * filters" at the end while any is set. The button shows how many are set.
 * The menu stays open while someone picks.
 */
export function FilterMenu({
  groups,
  onClear
}: {
  groups: readonly FilterGroup[]
  /** Resets every group. Default: each group's own onChange with its reset value. */
  onClear?: () => void
}): JSX.Element | null {
  if (groups.length === 0) return null
  const active = filtersActive(groups)
  const items: MenuItem[] = groups.flatMap((group, at) =>
    group.choices.map((choice, index) => ({
      id: `${group.id}:${choice.value}`,
      label: choice.label,
      ariaLabel: `${group.label}: ${choice.label}`,
      ...(choice.count !== undefined ? { hint: choice.count.toLocaleString('en-US') } : {}),
      checked: group.value === choice.value,
      keepOpen: true,
      ...(index === 0 ? { groupLabel: group.label, groupStart: at > 0 } : {}),
      ...(index > 0 && choice.groupLabel ? { groupLabel: choice.groupLabel } : {}),
      onSelect: () => group.onChange(choice.value)
    }))
  )
  if (active > 0) {
    items.push({
      id: 'clear-filters',
      label: 'Clear filters',
      icon: 'x',
      groupStart: true,
      onSelect: () => {
        if (onClear) onClear()
        else for (const group of groups) group.onChange(group.resetValue)
      }
    })
  }
  return (
    <MenuButton
      label="Filter"
      items={items}
      width={280}
      align="start"
      trigger={({ ref, ...props }) => (
        <button
          ref={ref}
          type="button"
          className={[
            'ui-icon-btn ui-icon-btn-sm ui-lg-filter-btn',
            active > 0 ? 'ui-lg-filter-on' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={active > 0 ? `Filter, ${active} set` : 'Filter'}
          data-tip="Filter"
          {...props}
        >
          <UiIcon name="filter" size={16} />
          {active > 0 ? <span className="ui-lg-filter-count num">{active}</span> : null}
        </button>
      )}
    />
  )
}
