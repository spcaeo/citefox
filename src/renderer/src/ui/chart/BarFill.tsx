import type { CSSProperties, JSX } from 'react'

export type BarTone = 'cited' | 'own' | 'other' | 'past' | 'info'

/**
 * One calm bar: a soft rounded track with its fill. Horizontal by default; a
 * column grows up. Lives inside the control that drills it (a DrillButton), so
 * the hover readout and the click belong to the same element.
 */
export function BarFill({
  share,
  tone = 'cited',
  orientation = 'row',
  faint = false
}: {
  /** 0–1. */
  share: number
  tone?: BarTone
  orientation?: 'row' | 'column'
  /** The compared check's bar under the current one. */
  faint?: boolean
}): JSX.Element {
  const percent = Math.max(0, Math.min(1, share)) * 100
  return (
    <span
      className={`ui-bar ui-bar-${orientation}${faint ? ' ui-bar-faint' : ''}`}
      aria-hidden="true"
    >
      <span
        className={`ui-bar-fill ui-bar-${tone}`}
        style={{ '--bar': `${percent}%` } as CSSProperties}
      />
    </span>
  )
}
