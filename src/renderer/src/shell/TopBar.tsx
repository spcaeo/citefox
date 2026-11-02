import type { JSX, ReactNode } from 'react'
import { UiIcon } from '../ui/UiIcon'
import type { BreadcrumbItem } from './breadcrumb'
import { ASK_SHORTCUT } from './askShortcut'

/**
 * The slim 48px top bar (Header.dc.html): spruce like the sidebar, so the two
 * read as one frame. The breadcrumb on the left (ancestors are links, the
 * current screen is white); on the right the ⌘K search, Activity and searches
 * left as icon buttons with badges, ✦ Ask, the theme switch and the ⚙ menu
 * (settings, version). As the content column narrows the search folds to its icon first,
 * then Ask folds to its ✦ (shell.css). Long crumbs shorten with an ellipsis
 * and keep their full text as a tooltip.
 */
export function TopBar({
  crumbs,
  status,
  onAsk,
  askOpen,
  activity,
  search,
  theme,
  settings,
  guide,
  help
}: {
  crumbs: readonly BreadcrumbItem[]
  /** Searches left: the icon button and its popover. */
  status: ReactNode
  /** Opens Ask CiteFox. Absent with no project: the button is not shown. */
  onAsk?: () => void
  askOpen: boolean
  /** The Activity icon button, before searches left. */
  activity?: ReactNode
  /** The ⌘K search box, first on the right. Absent with no project. */
  search?: ReactNode
  /** Light, Dark or System, just before the ⚙ menu. */
  theme?: ReactNode
  /** The ⚙ menu, last on the right. */
  settings?: ReactNode
  /** The first-run guide's progress ring ("3/16"), before Activity. */
  guide?: ReactNode
  /** "What is this page?" (the guide's "?"), right after the breadcrumb. */
  help?: ReactNode
}): JSX.Element {
  return (
    <header className="topbar">
      <nav className="topbar-crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <li key={`${index}:${crumb.label}`}>
                {index > 0 ? (
                  <span className="topbar-sep" aria-hidden="true">
                    <UiIcon name="chevron-right" size={14} />
                  </span>
                ) : null}
                {crumb.href && !last ? (
                  <a href={crumb.href} title={crumb.label}>
                    {crumb.label}
                  </a>
                ) : (
                  <span
                    className="topbar-crumb"
                    title={crumb.label}
                    aria-current={last ? 'page' : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      {help}
      <div className="topbar-end">
        {search}
        {guide}
        {activity}
        {status}
        {onAsk ? (
          <button
            type="button"
            className="topbar-ask"
            onClick={onAsk}
            aria-label="Ask CiteFox"
            aria-expanded={askOpen}
            aria-keyshortcuts={ASK_SHORTCUT.aria}
            data-tip={`Ask CiteFox (${ASK_SHORTCUT.text})`}
            data-testid="topbar-ask"
          >
            <UiIcon name="sparkle" />
            <span className="topbar-ask-text">Ask</span>
          </button>
        ) : null}
        {theme}
        {settings}
      </div>
    </header>
  )
}
