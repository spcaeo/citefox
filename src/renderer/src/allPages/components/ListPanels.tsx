import { useState, type JSX } from 'react'
import type { GridViewState } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import type { GridColumn } from '../../grid'
import { facetOptions, type RowIndex } from '../../grid/model/rows'
import { Button, IconButton, SegmentedControl, UiIcon, type SegmentOption } from '../../ui'
import { activeFilters, type PagesGroupId } from '../utils/presets'

type Filters = Readonly<Record<string, readonly string[]>>

function chipText(column: GridColumn<AllPageRow> | undefined, value: string): string {
  if (!column) return value
  const filter = column.filter
  const label = filter?.kind === 'facet' && filter.label ? filter.label(value) : value
  const name = filter?.kind === 'facet' && filter.chip ? filter.chip : column.label
  return `${name}: ${label}`
}

/** The filters that are on, each with a remove button, and Clear all. */
export function FilterChips({
  columns,
  filters,
  onRemove,
  onClear
}: {
  columns: readonly GridColumn<AllPageRow>[]
  filters: Filters
  onRemove: (columnId: string, value: string) => void
  onClear: () => void
}): JSX.Element | null {
  const on = activeFilters(filters)
  if (on.length === 0) return null
  return (
    <div className="ap-fchips" role="group" aria-label="Active page filters">
      {on.map(([id, value]) => {
        const text = chipText(
          columns.find((column) => column.id === id),
          value
        )
        return (
          <span key={`${id}:${value}`} className="ap-fchip">
            {text}
            <IconButton
              icon="x"
              size="sm"
              label={`Remove filter ${text}`}
              onClick={() => onRemove(id, value)}
            />
          </span>
        )
      })}
      <Button variant="text" size="sm" onClick={onClear}>
        Clear all
      </Button>
    </div>
  )
}

/**
 * FR-21.1 column filters: one checkbox per value with counts that reflect the
 * other filters. Opened from the list toolbar's Filters button.
 */
export function FiltersPanel({
  id,
  index,
  columns,
  filters,
  onToggle,
  onClear,
  onClose
}: {
  id: string
  index: RowIndex<AllPageRow>
  columns: readonly GridColumn<AllPageRow>[]
  filters: Filters
  onToggle: (columnId: string, value: string) => void
  onClear: () => void
  onClose: () => void
}): JSX.Element {
  const state: Pick<GridViewState, 'search' | 'filters' | 'ranges'> = {
    search: '',
    filters,
    ranges: {}
  }
  const facets = columns.filter((column) => column.filter?.kind === 'facet')
  return (
    <section className="ap-panel" id={id} aria-label="Page filters">
      <div className="ap-panel-head">
        <h3>Filters</h3>
        <span className="ap-panel-hint">Counts show matches with your other filters on.</span>
        <IconButton
          icon="x"
          size="sm"
          label="Close filters"
          data-tip="Close filters"
          onClick={onClose}
        />
      </div>
      <div className="ap-facets">
        {facets.map((column) => {
          const options = facetOptions(index, state, columns, column)
          if (options.length < 2 && !options.some((option) => option.checked)) return null
          const legend =
            column.filter?.kind === 'facet' && column.filter.chip
              ? column.filter.chip
              : column.label
          return (
            <fieldset key={column.id} className="ap-facet">
              <legend>{legend}</legend>
              <div className="ap-facet-list">
                {options.map((option) => (
                  <label key={option.value} className="ap-check">
                    <input
                      type="checkbox"
                      className="ui-check"
                      checked={option.checked}
                      onChange={() => onToggle(column.id, option.value)}
                    />
                    <span className="ap-check-label">{option.label}</span>
                    <span className="ap-check-count num">
                      {option.count.toLocaleString('en-US')}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )
        })}
      </div>
      <div className="ap-panel-foot">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear all filters
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </section>
  )
}

/** "Choose columns": the optional columns as checkboxes. Page always shows. */
export function ColumnsPanel({
  id,
  columns,
  hidden,
  groupBy,
  hasClusters,
  onGroup,
  onToggle,
  onReset,
  onClose
}: {
  id: string
  columns: readonly GridColumn<AllPageRow>[]
  hidden: readonly string[]
  groupBy: PagesGroupId
  hasClusters: boolean
  onGroup: (groupBy: PagesGroupId) => void
  onToggle: (columnId: string) => void
  onReset: () => void
  onClose: () => void
}): JSX.Element {
  const groups: SegmentOption<string>[] = [
    { value: 'folder', label: 'Folder' },
    ...(hasClusters ? [{ value: 'cluster', label: 'Cluster' }] : []),
    { value: 'status', label: 'Status' },
    { value: 'none', label: 'None' }
  ]
  return (
    <section className="ap-panel" id={id} aria-label="Group and columns">
      <div className="ap-panel-head">
        <h3>Group and columns</h3>
        <span className="ap-panel-hint">Pick what the list shows. CSV export uses the same.</span>
        <IconButton
          icon="x"
          size="sm"
          label="Close group and columns"
          data-tip="Close group and columns"
          onClick={onClose}
        />
      </div>
      <div className="ap-group-row">
        <span className="ap-group-label">Group by</span>
        <SegmentedControl
          label="Group by"
          size="sm"
          options={groups}
          value={groupBy ?? 'none'}
          onChange={(value) => onGroup(value === 'none' ? null : (value as PagesGroupId))}
        />
      </div>
      <div className="ap-columns">
        {columns.map((column) => (
          <label key={column.id} className="ap-check">
            <input
              type="checkbox"
              className="ui-check"
              checked={column.fixed === true || !hidden.includes(column.id)}
              disabled={column.fixed === true}
              onChange={() => onToggle(column.id)}
            />
            <span className="ap-check-label">{column.label}</span>
            {column.fixed ? (
              <span className="ap-check-count">Always shown</span>
            ) : column.note ? (
              <span className="ap-check-count">{column.note}</span>
            ) : null}
          </label>
        ))}
      </div>
      <div className="ap-panel-foot">
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </section>
  )
}

/** Names and saves the current view (FR-21.2). */
export function SaveViewPanel({
  busy,
  onSave,
  onClose
}: {
  busy: boolean
  onSave: (name: string) => Promise<boolean>
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const ready = name.trim().length > 0
  return (
    <section className="ap-panel ap-save" aria-label="Save this view">
      <form
        className="ap-save-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready) return
          void onSave(name.trim()).then((ok) => {
            if (ok) onClose()
          })
        }}
      >
        <UiIcon name="layers" size={16} />
        <label className="ap-save-label">
          <span className="sr-only">View name</span>
          <input
            className="ui-input ui-input-sm"
            placeholder="View name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <span className="ap-panel-hint">Saves the view, filters, sort, grouping and columns.</span>
        <Button type="submit" size="sm" disabled={!ready} busy={busy}>
          Save view
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </form>
    </section>
  )
}
