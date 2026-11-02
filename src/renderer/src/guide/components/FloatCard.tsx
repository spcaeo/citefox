import { useId, type JSX, type ReactNode } from 'react'
import { IconButton, UiIcon, type UiIconName } from '../../ui'

/** Where tips come back on (Settings › General). */
export const GUIDE_SETTINGS_HREF = '#/settings?tab=general'

/**
 * A small card in the window's lower right: the kick-off, a page explainer and
 * "Lesson done". It never covers the screen and never takes focus by itself;
 * it is a labelled region with its own close. `stop` adds a "Don't show again"
 * box on the buttons' line (so the card is no taller); the card that passes it acts on
 * the tick when it closes, and a tick shows where tips come back on.
 */
export function FloatCard({
  icon,
  title,
  children,
  actions,
  onClose,
  closeLabel,
  testId,
  stop,
  over = false
}: {
  icon: UiIconName
  title: string
  children: ReactNode
  actions: ReactNode
  onClose: () => void
  closeLabel: string
  testId: string
  stop?: { checked: boolean; onChange: (checked: boolean) => void }
  /** Over an open drawer too (a lesson that ends inside one). */
  over?: boolean
}): JSX.Element {
  const titleId = useId()
  const stopId = useId()
  return (
    <section
      className={over ? 'gd-float gd-float-over' : 'gd-float'}
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div className="gd-float-head">
        <span className="gd-float-icon" aria-hidden="true">
          <UiIcon name={icon} size={16} />
        </span>
        <h2 id={titleId} className="gd-float-title">
          {title}
        </h2>
        <IconButton icon="x" size="sm" label={closeLabel} data-tip={closeLabel} onClick={onClose} />
      </div>
      <div className="gd-float-body">{children}</div>
      {stop?.checked ? (
        <p className="gd-float-hint" id={stopId}>
          Turn tips back on any time in{' '}
          <a href={GUIDE_SETTINGS_HREF} onClick={onClose}>
            Settings › General
          </a>
          .
        </p>
      ) : null}
      <div className="gd-float-actions">
        {stop ? (
          <label className="gd-float-check">
            <input
              type="checkbox"
              checked={stop.checked}
              aria-describedby={stop.checked ? stopId : undefined}
              onChange={(event) => stop.onChange(event.target.checked)}
            />
            Don&apos;t show again
          </label>
        ) : null}
        {actions}
      </div>
    </section>
  )
}
