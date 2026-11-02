import type { JSX } from 'react'

export function Switch({
  on,
  label,
  labelledBy,
  onToggle
}: {
  on: boolean
  label?: string
  labelledBy?: string
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={on ? 'switch on' : 'switch'}
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-labelledby={labelledBy}
      onClick={onToggle}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="knob" />
    </button>
  )
}
