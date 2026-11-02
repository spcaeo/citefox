import { useId, type JSX, type ReactNode } from 'react'

export interface PanelProps {
  /** Heading text. Omit for a panel without a title row. */
  title?: ReactNode
  /** Heading level. Default `h2`. */
  titleAs?: 'h2' | 'h3'
  /** Controls at the right of the title row (one AI menu, a close button). */
  actions?: ReactNode
  children?: ReactNode
  /** `inset` uses the inset ground (Theme "Elevation" card). */
  tone?: 'default' | 'inset'
  /** Inner padding. Default 24 (cards pad 24). */
  padding?: 0 | 16 | 20 | 24
  className?: string
  /** Accessible name when there is no title. */
  label?: string
}

/**
 * A small context card (Theme "Panels"): surface, 1px line, radius 10, E1.
 * Cards are only for KPI tiles and small context panels; lists use ListGrid.
 */
export function Panel({
  title,
  titleAs = 'h2',
  actions,
  children,
  tone = 'default',
  padding = 24,
  className,
  label
}: PanelProps): JSX.Element {
  const headingId = useId()
  const Heading = titleAs
  return (
    <section
      className={['ui-panel', tone === 'inset' ? 'ui-panel-inset' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{ padding }}
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : label}
    >
      {title || actions ? (
        <div className="ui-panel-head">
          {title ? (
            <Heading id={headingId} className="ui-panel-title">
              {title}
            </Heading>
          ) : (
            <span />
          )}
          {actions ? <div className="ui-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** The right-hand context column of an 8 + 4 layout: panels stacked 24 apart. */
export function RightRail({
  children,
  label = 'Context'
}: {
  children: ReactNode
  /** Accessible name of the aside. Default "Context". */
  label?: string
}): JSX.Element {
  return (
    <aside className="ui-rail" aria-label={label}>
      {children}
    </aside>
  )
}
