import type { JSX } from 'react'
import { MARKER_CHIP, MARKER_FACE, MARKER_KINDS, type MarkerKind } from './markers'
import { MarkerDot } from './MarkerDot'

/**
 * Chips above a trend chart that show or hide each kind of marker. Only kinds the
 * chart has are offered. The choice lives in the URL (`marks.hide`), so it is kept
 * by a copied link and shared by every chart on the screen.
 */
export function MarkerToggles({
  kinds,
  hidden,
  onToggle
}: {
  kinds: ReadonlySet<MarkerKind>
  hidden: ReadonlySet<MarkerKind>
  onToggle: (kind: MarkerKind) => void
}): JSX.Element | null {
  const offered = MARKER_KINDS.filter((kind) => kinds.has(kind))
  if (offered.length === 0) return null
  return (
    <div className="ui-chart-toggles" role="group" aria-label="Show on chart">
      {offered.map((kind) => (
        <button
          key={kind}
          type="button"
          className="ui-chart-toggle"
          aria-pressed={!hidden.has(kind)}
          onClick={() => onToggle(kind)}
        >
          <MarkerDot kind={kind} label={kind === 'fix' ? '1' : MARKER_FACE[kind]} small />
          {MARKER_CHIP[kind]}
        </button>
      ))}
    </div>
  )
}
