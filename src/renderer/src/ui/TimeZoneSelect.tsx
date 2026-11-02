import { useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { listTimeZones, searchZones, zoneLabel, zoneOptions } from './timeZones'
import { UiIcon } from './UiIcon'

/** Matches drawn at once; typing narrows the rest. */
const SHOWN = 80

export interface TimeZoneSelectProps {
  id: string
  /** An IANA zone, such as `Europe/London`. */
  value: string
  onChange: (zone: string) => void
  describedBy?: string
  /** The zones offered. Default: every zone this computer knows. */
  zones?: readonly string[]
  /** The instant offsets are worked out for (tests). Default: now. */
  at?: Date
  testId?: string
}

/**
 * A searchable time zone picker (combobox + listbox): it shows the picked zone
 * with its offset now ("Europe/London · UTC+1"); typing filters by city,
 * region or offset ("london", "utc+5:30"). Arrow keys move, Enter picks,
 * Escape closes the list without closing the drawer around it.
 */
export function TimeZoneSelect({
  id,
  value,
  onChange,
  describedBy,
  zones,
  at,
  testId
}: TimeZoneSelectProps): JSX.Element {
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const instant = useMemo(() => at ?? new Date(), [at])
  const options = useMemo(() => zoneOptions(zones ?? listTimeZones(), instant), [zones, instant])
  const matches = useMemo(() => searchZones(options, query), [options, query])
  const shown = matches.slice(0, SHOWN)
  const current = zoneLabel(value, instant)

  function pick(zone: string): void {
    onChange(zone)
    setOpen(false)
    setQuery('')
  }

  function show(): void {
    setOpen(true)
    setQuery('')
    const at = options.findIndex((option) => option.zone === value)
    setActive(at < 0 ? 0 : Math.min(at, SHOWN - 1))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        show()
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((now) => Math.max(0, Math.min(shown.length - 1, now + step)))
    } else if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      const option = shown[active]
      if (option) pick(option.zone)
    } else if (event.key === 'Escape' && open) {
      // Close the list only: the drawer stays open.
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      setOpen(false)
      setQuery('')
    }
  }

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined

  return (
    <div className="ui-tz" data-testid={testId}>
      <div className="ui-tz-field">
        <input
          ref={input}
          id={id}
          className="ui-input ui-tz-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          placeholder={open ? 'Search a city, region or UTC+1' : undefined}
          value={open ? query : current}
          onFocus={(event) => event.currentTarget.select()}
          onClick={() => {
            if (!open) show()
          }}
          onChange={(event) => {
            if (!open) setOpen(true)
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false)
            setQuery('')
          }}
        />
        <UiIcon name="chevron-down" size={16} className="ui-tz-chevron" />
      </div>
      {open ? (
        <div className="ui-tz-pop">
          <ul id={listId} role="listbox" aria-label="Time zones" className="ui-tz-list">
            {shown.map((option, index) => (
              <li
                key={option.zone}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.zone === value}
                className={index === active ? 'ui-tz-option active' : 'ui-tz-option'}
                onMouseDown={(event) => {
                  // Keep focus in the input so blur does not close the list first.
                  event.preventDefault()
                  pick(option.zone)
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span className="ui-tz-zone">{option.zone.replace(/_/g, ' ')}</span>
                <span className="ui-tz-offset num">{option.label.split(' · ')[1]}</span>
              </li>
            ))}
          </ul>
          <p className="ui-tz-note" role="status">
            {matches.length === 0
              ? 'No time zone matches. Try a city such as London or an offset such as UTC+1.'
              : matches.length > SHOWN
                ? `${SHOWN} of ${matches.length.toLocaleString('en-US')} zones · keep typing to narrow`
                : `${matches.length.toLocaleString('en-US')} ${matches.length === 1 ? 'zone' : 'zones'}`}
          </p>
        </div>
      ) : null}
    </div>
  )
}
