import type { JSX, ReactNode } from 'react'
import type { GridCellDrill } from '../../grid/types'

/** A drill cell's content inside a button (drawer, popover) or a link (route, URL). */
export function CellDrill({
  drill,
  children
}: {
  drill: GridCellDrill
  children: ReactNode
}): JSX.Element {
  if ('href' in drill) {
    return drill.external ? (
      <a
        className="dg-drill"
        href={drill.href}
        aria-label={drill.label}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ) : (
      <a className="dg-drill" href={drill.href} aria-label={drill.label}>
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      className="dg-drill"
      aria-label={drill.label}
      data-nfr-drill={drill.nfrId}
      onClick={drill.onOpen}
    >
      {drill.nfrId ? <span data-nfr-figure={drill.nfrId}>{children}</span> : children}
    </button>
  )
}
