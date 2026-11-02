import { useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Shown after the label in a lighter tone, such as a row count. */
  count?: number
  /** A small decorative mark before the label, such as an engine's logo. */
  icon?: ReactNode
  /** Shows only the icon; the label stays the button's name (aria-label) and its `data-tip` tooltip. */
  iconOnly?: boolean
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group, such as "Status" or "How deep". */
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** `md` 36px (default), `sm` 32px (grid toolbars). */
  size?: 'md' | 'sm'
  className?: string
}

/**
 * A choice of 2–5 options (Theme.dc.html `.seg`). Each option is a toggle
 * button with `aria-pressed`; only the picked one is in the Tab order, and
 * Left/Right (Up/Down), Home and End move and pick, like a radio group.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className
}: SegmentedControlProps<T>): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = options.length - 1
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = index >= last ? 0 : index + 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = index <= 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    const option = options[next]
    if (!option) return
    onChange(option.value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={['ui-seg', size === 'sm' ? 'ui-seg-sm' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((option, index) => {
        const on = option.value === value
        const iconOnly = Boolean(option.iconOnly && option.icon)
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            className={on ? 'ui-seg-btn on' : 'ui-seg-btn'}
            aria-pressed={on}
            tabIndex={index === current ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            aria-label={iconOnly ? option.label : undefined}
            data-tip={iconOnly ? option.label : undefined}
          >
            {option.icon}
            {iconOnly ? null : option.label}
            {option.count !== undefined ? (
              <span className="ui-seg-count num">{option.count.toLocaleString('en-US')}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
