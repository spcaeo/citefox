import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { PICKER_NEW_VALUE, type PickerGroup, type PickerOption } from './PickerSelect'
import { UiIcon } from './UiIcon'

/** A choice with an optional icon or logo before its words and a quiet hint after them. */
export interface DropdownOption extends PickerOption {
  icon?: ReactNode
  hint?: string
}

export interface DropdownGroup extends Omit<PickerGroup, 'options'> {
  options: readonly DropdownOption[]
}

export interface DropdownProps {
  value: string
  onChange: (value: string) => void
  /** Flat options, or groups ("Topics", "Pages"), the same as PickerSelect. */
  options: readonly (DropdownOption | DropdownGroup)[]
  /** A first, empty choice such as "Pick a topic". Absent: none. */
  placeholder?: string
  /** "+ New topic…" as the last choice. Picking it calls `onCreate` and keeps the value. */
  createLabel?: string
  onCreate?: () => void
  /** Search box on top of the list. Default: on from 8 choices. */
  searchable?: boolean
  /** `sm` for toolbars and page headers (32 px). Default `md`. */
  size?: 'sm' | 'md'
  /** Words before the value on the button, such as "Market". Also its name when there is no aria-label. */
  prefix?: string
  id?: string
  className?: string
  disabled?: boolean
  title?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/** From this many choices a search box shows. */
const SEARCH_FROM = 8
const GAP = 4
const EDGE = 8
const LIST_HEIGHT = 320

type Line =
  { kind: 'group'; label: string } | { kind: 'option'; option: DropdownOption; create?: boolean }

function isGroup(option: DropdownOption | DropdownGroup): option is DropdownGroup {
  return 'options' in option
}

/**
 * The one dropdown for toolbars and page headers (grid audit A3), drawn the
 * monday way: a button showing the choice, a list with a tick on it, icons
 * or logos in options, and a search box on long lists. It keeps PickerSelect's
 * props, so a `<PickerSelect>` swaps for a `<Dropdown>` in place. Keyboard:
 * Enter, Space or the arrows open it; arrows, Home and End move; typing
 * searches (or jumps to a choice without a search box); Enter picks; Escape
 * closes and focus returns to the button.
 */
export function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  createLabel,
  onCreate,
  searchable,
  size = 'md',
  prefix,
  id,
  className,
  disabled,
  title,
  ...aria
}: DropdownProps): JSX.Element {
  const listId = useId()
  const optionBase = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setActive] = useState(0)
  const [place, setPlace] = useState<CSSProperties>({})

  const flat = useMemo(
    () => options.flatMap((option) => (isGroup(option) ? option.options : [option])),
    [options]
  )
  const withSearch = searchable ?? flat.length >= SEARCH_FROM
  const chosen = flat.find((option) => option.value === value) ?? null

  const lines = useMemo<Line[]>(() => {
    const needle = query.trim().toLowerCase()
    const keep = (option: DropdownOption): boolean =>
      needle === '' || option.label.toLowerCase().includes(needle)
    const out: Line[] = []
    if (placeholder !== undefined && needle === '') {
      out.push({ kind: 'option', option: { value: '', label: placeholder } })
    }
    for (const option of options) {
      if (isGroup(option)) {
        const kept = option.options.filter(keep)
        if (kept.length === 0) continue
        out.push({ kind: 'group', label: option.label })
        for (const item of kept) out.push({ kind: 'option', option: item })
      } else if (keep(option)) {
        out.push({ kind: 'option', option })
      }
    }
    if (createLabel && onCreate) {
      out.push({
        kind: 'option',
        option: { value: PICKER_NEW_VALUE, label: createLabel },
        create: true
      })
    }
    return out
  }, [options, placeholder, query, createLabel, onCreate])

  const choices = useMemo(
    () =>
      lines.flatMap((line, at) => (line.kind === 'option' && !line.option.disabled ? [at] : [])),
    [lines]
  )

  // A search that hides the active choice moves it to the first match.
  const active = choices.includes(picked) ? picked : (choices[0] ?? 0)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setQuery('')
    if (refocus) buttonRef.current?.focus()
  }, [])

  function openList(which: 'chosen' | 'last'): void {
    if (disabled) return
    setQuery('')
    setOpen(true)
    const chosenAt = lines.findIndex(
      (line) => line.kind === 'option' && line.option.value === value
    )
    setActive(
      which === 'last'
        ? (choices[choices.length - 1] ?? 0)
        : chosenAt >= 0
          ? chosenAt
          : (choices[0] ?? 0)
    )
  }

  function pick(line: Line | undefined): void {
    if (!line || line.kind !== 'option' || line.option.disabled) return
    close(true)
    if (line.create) onCreate?.()
    else if (line.option.value !== value) onChange(line.option.value)
  }

  const reposition = useCallback((): boolean => {
    const box = buttonRef.current?.getBoundingClientRect()
    if (!box) return true
    if (box.bottom < 0 || box.top > window.innerHeight) return false
    const height = popRef.current?.offsetHeight ?? 0
    const below = window.innerHeight - box.bottom
    const top =
      below < height + GAP + EDGE && box.top > height + GAP
        ? box.top - GAP - height
        : box.bottom + GAP
    const width = Math.max(box.width, 200)
    const left = Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE))
    setPlace({ top, left, minWidth: width })
    return true
  }, [])

  useLayoutEffect(() => {
    if (open) reposition()
  }, [open, reposition, lines.length])

  useEffect(() => {
    if (!open) return
    ;(withSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true })
  }, [open, withSearch])

  useEffect(() => {
    if (!open) return
    document.getElementById(`${optionBase}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active, optionBase])

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent): void {
      const target = event.target as Node
      if (popRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close(false)
    }
    function onMove(event: Event): void {
      if (event.target instanceof Node && popRef.current?.contains(event.target)) return
      if (!reposition()) close(false)
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, close, reposition])

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openList('chosen')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openList('last')
    }
  }

  function onListKey(event: KeyboardEvent<HTMLElement>): void {
    const at = choices.indexOf(active)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = choices[Math.min(choices.length - 1, at + 1)]
    else if (event.key === 'ArrowUp') next = choices[Math.max(0, at - 1)]
    else if (event.key === 'Home' && !withSearch) next = choices[0]
    else if (event.key === 'End' && !withSearch) next = choices[choices.length - 1]
    else if (event.key === 'Enter') {
      event.preventDefault()
      pick(lines[active])
      return
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    } else if (event.key === 'Tab') {
      close(false)
      return
    } else if (!withSearch && event.key.length === 1 && /\S/.test(event.key)) {
      // Type-ahead: the next choice that starts with the letter.
      const letter = event.key.toLowerCase()
      const after = [...choices.slice(at + 1), ...choices.slice(0, at + 1)]
      next = after.find((index) => {
        const line = lines[index]
        return line?.kind === 'option' && line.option.label.toLowerCase().startsWith(letter)
      })
    }
    if (next !== undefined) {
      event.preventDefault()
      setActive(next)
    }
  }

  const name = aria['aria-label'] ?? prefix
  const activeId = open && lines[active]?.kind === 'option' ? `${optionBase}-${active}` : undefined
  const classes = ['ui-dd', size === 'sm' ? 'ui-dd-sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        className="ui-dd-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={name}
        aria-labelledby={aria['aria-labelledby']}
        aria-describedby={aria['aria-describedby']}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList('chosen'))}
        onKeyDown={onButtonKey}
      >
        {prefix ? <span className="ui-dd-prefix">{prefix}</span> : null}
        {chosen?.icon ? <span className="ui-dd-icon">{chosen.icon}</span> : null}
        <span className={chosen && chosen.value !== '' ? 'ui-dd-value' : 'ui-dd-value ui-dd-empty'}>
          {chosen?.label ?? placeholder ?? 'Choose…'}
        </span>
        <UiIcon name="chevron-down" size={14} className="ui-dd-caret" />
      </button>
      {open ? (
        <div ref={popRef} className="ui-dd-pop" style={place}>
          {withSearch ? (
            <label className="ui-dd-search">
              <UiIcon name="search" size={14} />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label={`Search ${name ?? 'choices'}`}
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onListKey}
              />
            </label>
          ) : null}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={name}
            aria-activedescendant={withSearch ? undefined : activeId}
            tabIndex={withSearch ? -1 : 0}
            className="ui-dd-list"
            style={{ maxHeight: LIST_HEIGHT }}
            onKeyDown={withSearch ? undefined : onListKey}
          >
            {lines.map((line, at) =>
              line.kind === 'group' ? (
                <li key={`g-${line.label}`} role="presentation" className="ui-dd-group">
                  {line.label}
                </li>
              ) : (
                <li
                  key={`o-${line.option.value}`}
                  id={`${optionBase}-${at}`}
                  role="option"
                  aria-selected={!line.create && line.option.value === value}
                  aria-disabled={line.option.disabled || undefined}
                  className={[
                    'ui-dd-option',
                    at === active ? 'on' : '',
                    line.create ? 'ui-dd-create' : '',
                    line.option.value === '' ? 'ui-dd-empty' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => {
                    if (!line.option.disabled) setActive(at)
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(line)}
                >
                  {line.create ? (
                    <UiIcon name="plus" size={14} className="ui-dd-icon" />
                  ) : line.option.icon ? (
                    <span className="ui-dd-icon">{line.option.icon}</span>
                  ) : null}
                  <span className="ui-dd-label">{line.option.label}</span>
                  {line.option.hint ? <span className="ui-dd-hint">{line.option.hint}</span> : null}
                  {!line.create && line.option.value === value ? (
                    <UiIcon name="check" size={14} className="ui-dd-tick" />
                  ) : null}
                </li>
              )
            )}
            {choices.length === 0 ? (
              <li role="presentation" className="ui-dd-none">
                Nothing matches “{query.trim()}”
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </span>
  )
}
