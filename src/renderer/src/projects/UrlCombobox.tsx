import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { StartUrlSuggestion, StartUrlSuggestions } from '@shared/ipc'
import { useDebouncedValue } from '../shell/useDebouncedValue'

/** Pause in typing before the sitemap is searched. */
export const URL_SUGGEST_DEBOUNCE_MS = 150

export interface UrlComboboxProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** The hint under the box. */
  describedBy?: string
  /** Sitemap pages matching what was typed. Without it this is a plain address box. */
  suggest?: (query: string) => Promise<StartUrlSuggestions>
}

/**
 * The Add page address box with the project's sitemap pages as suggestions
 * (owner feedback 4: never a blank URL box). An ARIA 1.2 combobox: Arrow keys
 * move through the list, Enter picks, Escape closes, and typing still accepts
 * any address.
 */
export function UrlCombobox({
  id,
  value,
  onChange,
  placeholder,
  describedBy,
  suggest
}: UrlComboboxProps): JSX.Element {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [result, setResult] = useState<StartUrlSuggestions | null>(null)
  const query = useDebouncedValue(value, URL_SUGGEST_DEBOUNCE_MS)
  const latest = useRef(0)

  useEffect(() => {
    if (!suggest || !open) return
    const ticket = latest.current + 1
    latest.current = ticket
    suggest(query).then(
      (next) => {
        if (latest.current !== ticket) return
        setResult(next)
        setActive(-1)
      },
      () => {
        if (latest.current === ticket) setResult(null)
      }
    )
  }, [suggest, query, open])

  const options = result?.suggestions ?? []
  const shown = open && options.length > 0
  const optionId = (index: number): string => `${listId}-opt-${index}`

  function pick(option: StartUrlSuggestion): void {
    onChange(option.url)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (options.length > 0) setActive((current) => (current + 1) % options.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length > 0)
        setActive((current) => (current <= 0 ? options.length - 1 : current - 1))
      return
    }
    if (event.key === 'Enter' && shown && active >= 0) {
      const option = options[active]
      if (option) {
        event.preventDefault()
        pick(option)
      }
      return
    }
    if (event.key === 'Escape' && shown) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="ap2-combo">
      <input
        id={id}
        className="ui-input mono"
        type="url"
        role={suggest ? 'combobox' : undefined}
        aria-autocomplete={suggest ? 'list' : undefined}
        aria-expanded={suggest ? shown : undefined}
        aria-controls={suggest ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {suggest ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Pages in your sitemap"
          className="ap2-combo-list"
          hidden={!shown}
        >
          {options.map((option, index) => (
            <li
              key={option.url}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className="ap2-combo-option"
              // Keep focus in the box so the pick lands before blur closes the list.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              onMouseEnter={() => setActive(index)}
            >
              <span className="ap2-combo-path mono">{option.path}</span>
              <span className="ap2-combo-meta">
                {option.title ? <span className="ap2-combo-title">{option.title}</span> : null}
                <span className="faint">
                  {option.alreadyTracked ? `${option.section} · tracked` : option.section}
                </span>
              </span>
            </li>
          ))}
          {result && result.total > options.length ? (
            <li role="presentation" className="ap2-combo-more faint">
              {result.total.toLocaleString('en-US')} matching pages · keep typing to narrow
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
