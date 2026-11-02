import { useId, type JSX, type ReactNode } from 'react'
import { Button } from '../Button'

/** Columns a box spans on the drawer's 12-column grid. Never narrower than 4. */
export type DrawerSpan = 4 | 6 | 8 | 12

/**
 * The drawer body's 12-column grid (deep audit §2.3). Boxes in a row share
 * their height; a side rail is 4 of 12 columns or none. Under 720 px of
 * drawer every box takes the full row.
 */
export function DrawerGrid({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={className ? `ui-drawer-grid ${className}` : 'ui-drawer-grid'}>{children}</div>
  )
}

function Skeleton({ lines = 3 }: { lines?: number }): JSX.Element {
  const widths = ['92%', '74%', '84%', '61%', '78%']
  return (
    <div className="ui-drawer-skel" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="ui-drawer-skel-line"
          style={{ width: widths[index % widths.length] }}
        />
      ))}
    </div>
  )
}

export interface DrawerSectionProps {
  /** The section's name, sentence case: "Where the questions go". */
  title?: string
  /** A count after the title. */
  count?: number | string
  /** One helper line under the title. */
  description?: ReactNode
  /** Right-aligned actions (one secondary at most) and the one AI menu. */
  actions?: ReactNode
  span?: DrawerSpan
  /** `box` (default) is a bordered box; `plain` has no border, for a list that fills the drawer. */
  tone?: 'box' | 'plain'
  /** The section's own greyed lines while its data loads. */
  loading?: boolean
  /** The section failed: the message sits here, not over the whole drawer. */
  error?: string | null
  onRetry?: () => void
  children?: ReactNode
  testId?: string
  /** `data-guide`, for the first-run guide's coachmark. */
  guide?: string
  className?: string
}

/** A box on the drawer grid: a title row, one hint line, then its content. */
export function DrawerSection({
  title,
  count,
  description,
  actions,
  span = 12,
  tone = 'box',
  loading = false,
  error = null,
  onRetry,
  children,
  testId,
  guide,
  className
}: DrawerSectionProps): JSX.Element {
  const headingId = useId()
  return (
    <section
      className={[
        'ui-drawer-section',
        `ui-drawer-span-${span}`,
        tone === 'plain' ? 'ui-drawer-section-plain' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={title ? headingId : undefined}
      aria-busy={loading || undefined}
      data-testid={testId}
      data-guide={guide}
    >
      {title || actions ? (
        <div className="ui-drawer-section-head">
          <div className="ui-drawer-section-text">
            {title ? (
              <h3 id={headingId} className="ui-drawer-section-title">
                {title}
                {count !== undefined ? (
                  <span className="ui-drawer-section-count num">{count}</span>
                ) : null}
              </h3>
            ) : null}
            {description ? <p className="ui-drawer-section-desc">{description}</p> : null}
          </div>
          {actions ? <div className="ui-drawer-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {error ? (
        <div className="ui-drawer-section-error" role="alert">
          <p>{error}</p>
          {onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : loading ? (
        <Skeleton />
      ) : (
        children
      )}
    </section>
  )
}

/** The 8-column main column: sections stacked, beside a DrawerRail. */
export function DrawerMain({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ui-drawer-main ui-drawer-span-8">{children}</div>
}

/** The 4-column right rail: context boxes stacked (where it goes, cost, AI help). */
export function DrawerRail({
  children,
  label = 'Context'
}: {
  children: ReactNode
  /** Accessible name of the rail. */
  label?: string
}): JSX.Element {
  return (
    <aside className="ui-drawer-rail ui-drawer-span-4" aria-label={label}>
      {children}
    </aside>
  )
}

/** Fields in one or two columns. Long inputs and text areas take `wide`. */
export function DrawerFields({
  columns = 1,
  children
}: {
  columns?: 1 | 2
  children: ReactNode
}): JSX.Element {
  return <div className={`ui-drawer-fields ui-drawer-fields-${columns}`}>{children}</div>
}

export interface DrawerFieldIds {
  /** Give it to the control as `id`. */
  id: string
  /** Give it to the control as `aria-describedby` (hint and error). */
  describedBy: string | undefined
}

export interface DrawerFieldProps {
  /** Above the field, 12 px semibold, sentence case. Never a placeholder. */
  label: string
  /** One line under the field. */
  hint?: ReactNode
  /** Replaces nothing: shown under the hint in the error colour, tied to the control. */
  error?: string | null
  /** At the right of the label row: "12 / 32 words". */
  counter?: ReactNode
  /** Spans both columns of a two-column field grid. */
  wide?: boolean
  /** The control's id when it has one; otherwise use the ids passed to `children`. */
  htmlFor?: string
  children: ReactNode | ((ids: DrawerFieldIds) => ReactNode)
}

/** A label above a control, one hint line under it, and the error under that. */
export function DrawerField({
  label,
  hint,
  error,
  counter,
  wide = false,
  htmlFor,
  children
}: DrawerFieldProps): JSX.Element {
  const auto = useId()
  const id = htmlFor ?? auto
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={wide ? 'ui-drawer-field ui-drawer-field-wide' : 'ui-drawer-field'}>
      <div className="ui-drawer-field-top">
        <label className="ui-drawer-label" htmlFor={id}>
          {label}
        </label>
        {counter ? <span className="ui-drawer-counter num">{counter}</span> : null}
      </div>
      {typeof children === 'function' ? children({ id, describedBy }) : children}
      {hint ? (
        <p id={hintId} className="ui-drawer-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ui-drawer-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Label/value pairs: labels quiet on the left, values on the right, baseline aligned. */
export function DrawerFacts({
  items,
  label
}: {
  items: readonly { label: string; value: ReactNode; hint?: ReactNode }[]
  /** Accessible name of the list. */
  label?: string
}): JSX.Element {
  return (
    <dl className="ui-drawer-facts" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className="ui-drawer-fact">
          <dt>{item.label}</dt>
          <dd>
            {item.value}
            {item.hint ? <span className="ui-drawer-fact-hint">{item.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The greyed real layout (8 + 4, then 6 + 6) while a drawer's data loads. */
export function DrawerSkeleton(): JSX.Element {
  return (
    <div className="ui-drawer-grid ui-drawer-loading" aria-hidden="true">
      <div className="ui-drawer-section ui-drawer-span-8">
        <span className="ui-drawer-skel-title" />
        <Skeleton lines={4} />
      </div>
      <div className="ui-drawer-section ui-drawer-span-4">
        <span className="ui-drawer-skel-title" />
        <Skeleton lines={2} />
      </div>
      <div className="ui-drawer-section ui-drawer-span-6">
        <span className="ui-drawer-skel-title" />
        <Skeleton lines={2} />
      </div>
      <div className="ui-drawer-section ui-drawer-span-6">
        <span className="ui-drawer-skel-title" />
        <Skeleton lines={2} />
      </div>
    </div>
  )
}
