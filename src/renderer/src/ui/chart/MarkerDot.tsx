import type { JSX } from 'react'
import type { MarkerKind } from './markers'

/** The round marker face: filled for a fix, a ring for Google, dashed for a page change. */
export function MarkerDot({
  kind,
  label,
  small = false
}: {
  kind: MarkerKind | 'mixed'
  label: string
  small?: boolean
}): JSX.Element {
  return (
    <span className={`ui-mk ui-mk-${kind}${small ? ' ui-mk-sm' : ''}`} aria-hidden="true">
      {label}
    </span>
  )
}
