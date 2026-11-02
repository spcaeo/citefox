import type { JSX } from 'react'

export function Switch({
  on,
  labelledBy,
  describedBy,
  disabled = false,
  onToggle
}: {
  on: boolean
  labelledBy: string
  describedBy?: string
  disabled?: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={on ? 'switch on' : 'switch'}
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="knob" />
    </button>
  )
}
