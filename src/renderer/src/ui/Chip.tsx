import type { JSX, ReactNode } from 'react'

/**
 * Semantic tones (Theme.dc.html "Chips"). `fox` marks your own thing (your
 * site, the picked one) and draws in the selected green, never the Not cited
 * orange (audit2 #4); `ok` success, `warn` re-check, `bad` over budget or failed, `info` a
 * neutral fact such as "Another page".
 */
export type ChipTone = 'neutral' | 'fox' | 'ok' | 'warn' | 'bad' | 'info'

export interface ChipProps {
  tone?: ChipTone
  /** A 6px dot in the text colour before the label. */
  dot?: boolean
  /** `md` 24px (default), `sm` 20px (inside grid rows and group headers). */
  size?: 'md' | 'sm'
  /** A title for screen readers when the visible text is terse. */
  label?: string
  className?: string
  children: ReactNode
}

/** A short status or tag pill (radius 999, chips only). Not interactive. */
export function Chip({
  tone = 'neutral',
  dot = false,
  size = 'md',
  label,
  className,
  children
}: ChipProps): JSX.Element {
  const classes = ['ui-chip', `ui-chip-${tone}`, size === 'sm' ? 'ui-chip-sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes}>
      {dot ? <span className="ui-dot" aria-hidden="true" /> : null}
      {label ? <span className="sr-only">{label}: </span> : null}
      {children}
    </span>
  )
}

/**
 * A small count pill, such as a group header's row count (Theme "List grid").
 * Pass `label` ("6 keywords") when the bare number needs words for a screen reader.
 */
export function Badge({
  children,
  label,
  className
}: {
  children: ReactNode
  /** Screen-reader text in place of the number, such as "6 keywords". */
  label?: string
  className?: string
}): JSX.Element {
  return (
    <span className={className ? `ui-badge num ${className}` : 'ui-badge num'}>
      {label ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        children
      )}
    </span>
  )
}
