import { useId, useMemo, useState, type JSX, type ReactNode } from 'react'
import { pluralize } from '@shared/pluralize'
import { Button, SearchBox, UrlText } from '../ui'
import { matchesQuery } from './model'
import type { PickerItem } from './types'
import './scope.css'

/** Rows drawn at once. Typing narrows the list; nothing is lost past the cap. */
export const PICKER_ROW_CAP = 150

export interface ItemPickerProps {
  /** Accessible name of the list, such as "Pages to check". */
  label: string
  items: readonly PickerItem[]
  selected: readonly string[]
  onChange: (ids: string[]) => void
  /** One pick (radio buttons) instead of many. Default many. */
  single?: boolean
  /** Singular and plural noun for counts: ['page', 'pages']. */
  noun: readonly [string, string]
  placeholder?: string
  /** Controlled search text (a drawer keeps it on the URL). */
  query?: string
  onQueryChange?: (query: string) => void
  /** Extra controls on the search row, such as a folder filter. */
  toolbar?: ReactNode
  /** The site a picked URL belongs to, for its icon and Open. */
  site?: string | null
  /** Largest list height before it scrolls, in pixels. Default 360. */
  maxHeight?: number
  /** Shown when there are no items at all. */
  empty?: ReactNode
  testId?: string
}

/**
 * A searchable list of checkboxes (or radios) that stays fast at 2,000+ rows:
 * it draws the first {@link PICKER_ROW_CAP} matches and says how many more
 * match, so typing is how you reach the rest. "Select all N matching" picks
 * every match, not only the drawn ones. Picked rows stay picked when a search
 * hides them; the count line says how many are picked in total.
 */
export function ItemPicker({
  label,
  items,
  selected,
  onChange,
  single = false,
  noun,
  placeholder,
  query: controlledQuery,
  onQueryChange,
  toolbar,
  site = null,
  maxHeight = 360,
  empty,
  testId
}: ItemPickerProps): JSX.Element {
  const [ownQuery, setOwnQuery] = useState('')
  const query = controlledQuery ?? ownQuery
  const setQuery = (value: string): void => {
    if (onQueryChange) onQueryChange(value)
    else setOwnQuery(value)
  }
  const name = useId()
  const picked = useMemo(() => new Set(selected), [selected])
  const matching = useMemo(() => items.filter((item) => matchesQuery(item, query)), [items, query])
  const shown = matching.slice(0, PICKER_ROW_CAP)
  const pickable = matching.filter((item) => !item.disabledReason)
  const allMatchingPicked = pickable.length > 0 && pickable.every((item) => picked.has(item.id))
  const [one, many] = noun

  function toggle(item: PickerItem): void {
    if (item.disabledReason) return
    if (single) {
      onChange([item.id])
      return
    }
    if (picked.has(item.id)) onChange(selected.filter((id) => id !== item.id))
    else onChange([...selected, item.id])
  }

  function pickAllMatching(): void {
    const next = new Set(selected)
    if (allMatchingPicked) for (const item of pickable) next.delete(item.id)
    else for (const item of pickable) next.add(item.id)
    onChange([...next])
  }

  if (items.length === 0) {
    return (
      <div className="sc-picker" data-testid={testId}>
        {empty ?? <p className="muted">Nothing to pick yet.</p>}
      </div>
    )
  }

  return (
    <div className="sc-picker" data-testid={testId}>
      <div className="sc-picker-bar">
        <SearchBox
          className="sc-picker-search"
          label={`Search ${many}`}
          inputProps={{
            placeholder: placeholder ?? `Search ${pluralize(items.length, one, many)}`
          }}
          value={query}
          onChange={setQuery}
        />
        {toolbar}
      </div>
      <div className="sc-picker-meta">
        <span className="faint" role="status" aria-live="polite">
          {single
            ? query
              ? `${pluralize(matching.length, one, many)} match`
              : pluralize(items.length, one, many)
            : `${selected.length.toLocaleString('en-US')} picked · ${pluralize(matching.length, one, many)} ${query ? 'match' : 'in all'}`}
        </span>
        {single ? null : (
          <span className="sc-picker-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={pickable.length === 0}
              onClick={pickAllMatching}
            >
              {allMatchingPicked
                ? `Unpick ${query ? 'these' : 'all'} ${pickable.length.toLocaleString('en-US')}`
                : `Pick ${query ? 'these' : 'all'} ${pickable.length.toLocaleString('en-US')}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={selected.length === 0}
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </span>
        )}
      </div>
      <ul
        className="sc-picker-list"
        aria-label={label}
        style={{ maxHeight }}
        role={single ? 'radiogroup' : 'group'}
      >
        {shown.map((item) => {
          const checked = picked.has(item.id)
          return (
            <li
              role="none"
              key={item.id}
              className="sc-picker-row"
              data-checked={checked ? 'true' : undefined}
              data-disabled={item.disabledReason ? 'true' : undefined}
              title={item.disabledReason}
            >
              <label className="sc-picker-label">
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name={single ? name : undefined}
                  checked={checked}
                  disabled={Boolean(item.disabledReason)}
                  onChange={() => toggle(item)}
                />
                <span className="sc-picker-text">
                  <span className="sc-picker-name">{item.label}</span>
                  {item.disabledReason ? (
                    <span className="faint sc-picker-note">{item.disabledReason}</span>
                  ) : null}
                </span>
              </label>
              {item.url ? (
                <span className="sc-picker-url">
                  <UrlText url={item.url} site={site} label={item.detail} icon={false} />
                </span>
              ) : item.detail ? (
                <span className="faint sc-picker-detail">{item.detail}</span>
              ) : null}
            </li>
          )
        })}
        {matching.length === 0 ? (
          <li role="none" className="sc-picker-none muted">
            No {many} match “{query}”.
          </li>
        ) : null}
      </ul>
      {matching.length > shown.length ? (
        <p className="faint sc-picker-more">
          Showing {shown.length.toLocaleString('en-US')} of{' '}
          {matching.length.toLocaleString('en-US')}. Type to narrow the list.
        </p>
      ) : null}
    </div>
  )
}
