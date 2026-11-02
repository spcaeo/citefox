import type { JSX, MouseEvent } from 'react'
import type { DrawerCrumb } from './types'

/**
 * The drawer's trail: project › section › entity, up to the drawer's parent.
 * The drawer's own name is the title right below, so it is not repeated here.
 * Each crumb with a place to go is a link. When the row is too narrow the last
 * crumb shortens first, then the middle ones; the first two (project, section)
 * keep their words. Each shortened crumb keeps its full text as a tooltip.
 */
export function Breadcrumbs({
  crumbs,
  onCrumb
}: {
  crumbs: readonly DrawerCrumb[]
  onCrumb: (crumb: DrawerCrumb, event: MouseEvent<HTMLElement>) => void
}): JSX.Element | null {
  if (crumbs.length === 0) return null
  const last = crumbs.length - 1
  return (
    <nav className="ui-drawer-crumbs" aria-label="Drawer breadcrumb">
      <ol>
        {crumbs.map((crumb, index) => {
          const place = index === last ? 'last' : index < 2 ? 'lead' : 'mid'
          const title = crumb.title ?? crumb.label
          return (
            <li
              key={`${index}:${crumb.label}`}
              className={`ui-drawer-crumb ui-drawer-crumb-${place}`}
            >
              {crumb.href !== undefined || crumb.onSelect ? (
                <a
                  href={crumb.href ?? '#'}
                  title={title}
                  onClick={(event) => onCrumb(crumb, event)}
                >
                  {crumb.label}
                </a>
              ) : (
                <span title={title}>{crumb.label}</span>
              )}
              {index < last ? (
                <span className="ui-drawer-crumb-sep" aria-hidden="true">
                  ›
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
