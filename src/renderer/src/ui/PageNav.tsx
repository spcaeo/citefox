import type { JSX, ReactNode } from 'react'
import { UiIcon, type UiIconName } from './UiIcon'

/** One step of the path. The last one is the current screen (no link). */
export interface PageNavLink {
  label: string
  href?: string
}

/** One end of the pager. A null `href` is the first or last item: the button is disabled. */
export interface PageNavStep {
  href: string | null
  /** Accessible name, such as "Previous prompt". */
  label: string
}

export interface PageNavProps {
  /** The back link at the left edge, such as Results. */
  back: { href: string; label: string }
  /** The path after the back link, such as Example Co / Alerts / Prompt 1. */
  crumbs?: readonly PageNavLink[]
  /** Steps through sibling screens at the right: "3 of 10" and previous and next. */
  pager?: {
    /** Accessible name of the group, such as "Step through prompts". */
    label: string
    /** 1-based position. */
    position: number
    total: number
    previous: PageNavStep
    next: PageNavStep
  }
  /** After the path, past a thin divider: such as the page's URL (`UrlText`). */
  detail?: ReactNode
  /** At the right, before the pager: such as the page's settings as chips. */
  end?: ReactNode
  className?: string
}

function Step({ step, icon }: { step: PageNavStep; icon: UiIconName }): JSX.Element {
  if (step.href === null) {
    return (
      <button type="button" className="ui-pagenav-step" aria-label={step.label} disabled>
        <UiIcon name={icon} size={16} />
      </button>
    )
  }
  return (
    <a className="ui-pagenav-step" href={step.href} aria-label={step.label}>
      <UiIcon name={icon} size={16} />
    </a>
  )
}

/**
 * The row above a drill-down screen's title: the back link flush with the
 * content edge, the path on the same baseline (middle steps cut with an
 * ellipsis), and the pager at the right. 32px tall on every screen.
 */
export function PageNav({
  back,
  crumbs = [],
  pager,
  detail,
  end,
  className
}: PageNavProps): JSX.Element {
  return (
    <div className={className ? `ui-pagenav ${className}` : 'ui-pagenav'}>
      <div className="ui-pagenav-path">
        <a className="ui-pagenav-back" href={back.href}>
          <UiIcon name="arrow-left" size={16} />
          {back.label}
        </a>
        {crumbs.length > 0 ? (
          <ol className="ui-pagenav-crumbs" aria-label="Path">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <li key={`${index}:${crumb.label}`} title={crumb.label}>
                  {crumb.href && !last ? (
                    <a href={crumb.href}>{crumb.label}</a>
                  ) : (
                    <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
                  )}
                </li>
              )
            })}
          </ol>
        ) : null}
        {detail ? <span className="ui-pagenav-detail">{detail}</span> : null}
      </div>
      {end ? <div className="ui-pagenav-end">{end}</div> : null}
      {pager ? (
        <nav className="ui-pagenav-pager" aria-label={pager.label}>
          <span className="num">
            {pager.position} of {pager.total}
          </span>
          <span className="ui-pagenav-steps">
            <Step step={pager.previous} icon="arrow-left" />
            <Step step={pager.next} icon="arrow-right" />
          </span>
        </nav>
      ) : null}
    </div>
  )
}
