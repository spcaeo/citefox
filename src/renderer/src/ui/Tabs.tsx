import { useId, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { tabDomId, tabPanelDomId } from './componentModels'

/** One tab. `count` shows as a small pill after the label, as in "To-do 17". */
export interface TabItem<T extends string> {
  id: T
  label: string
  count?: number | string
  /** A short word after the label, such as "Recommended". Read with the tab's name. */
  tag?: string
  /** A small decorative mark before the label, such as a status dot. Hidden from screen readers. */
  lead?: ReactNode
  /**
   * The tab's own URL, such as `#/pages/p1/results?view=checks`. Present: the
   * tab is a link (copyable, opens in place) and a click follows it as well as
   * calling `onChange`. The keyboard calls `onChange` only, so a caller that
   * keeps the tab in the URL navigates there.
   */
  href?: string
  /** A thin rule before the tab, setting it apart from the ones before (a view switcher's Progress). */
  divider?: boolean
  /** An extra class on this one tab, such as a quiet link-style tab. */
  className?: string
}

/** `md`: a screen's or page's tabs. `sm`: sub-tabs inside a tab, lighter so the two bars never look alike. */
export type TabsSize = 'md' | 'sm'

export interface TabsProps<T extends string> {
  /** Accessible name of the tablist, such as "Topic sections". */
  label: string
  tabs: readonly TabItem<T>[]
  /** The selected tab id. */
  value: T
  onChange: (id: T) => void
  /**
   * Id prefix of the panels. Tab `x` controls `${panelId}-x`; pair it with
   * `<TabPanel panelId={panelId} id="x">`. Default: a generated id (no panels linked).
   */
  panelId?: string
  /** Default `md`. Use `sm` for sub-tabs under a page's tabs. */
  size?: TabsSize
  className?: string
}

/**
 * The v2 tab strip (Theme.dc.html `.tab`): 44px tabs on a full-width rule; the
 * selected tab is ink, semibold, with a 3px fox underline. One tab stop
 * (roving tabindex); Arrow Left/Right wrap, Home and End jump, and moving
 * selects (automatic activation). `size="sm"` is the sub-tab strip: 36px,
 * 13px labels and a 2px ink underline, never the fox one.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  panelId,
  size = 'md',
  className
}: TabsProps<T>): JSX.Element {
  const generated = useId()
  const base = panelId ?? generated
  const refs = useRef<(HTMLElement | null)[]>([])

  function move(event: KeyboardEvent<HTMLElement>, index: number): void {
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next === null) return
    event.preventDefault()
    const tab = tabs[next]
    if (!tab) return
    onChange(tab.id)
    refs.current[next]?.focus()
  }

  const classes = ['ui-tabs', size === 'sm' ? 'ui-tabs-sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <div role="tablist" aria-label={label} className={classes}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value
        const shared = {
          role: 'tab',
          id: tabDomId(base, tab.id),
          'aria-selected': selected,
          'aria-controls': panelId ? tabPanelDomId(panelId, tab.id) : undefined,
          tabIndex: selected ? 0 : -1,
          className: ['ui-tab', tab.divider ? 'ui-tab-divided' : '', tab.className ?? '']
            .filter(Boolean)
            .join(' '),
          onClick: () => onChange(tab.id),
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => move(event, index)
        } as const
        const body = (
          <>
            {tab.lead !== undefined ? (
              <span className="ui-tab-lead" aria-hidden="true">
                {tab.lead}
              </span>
            ) : null}
            <span className="ui-tab-label" data-label={tab.label}>
              {tab.label}
            </span>
            {tab.tag !== undefined ? <span className="ui-tab-tag">{tab.tag}</span> : null}
            {tab.count !== undefined ? <span className="ui-tab-count num">{tab.count}</span> : null}
          </>
        )
        return tab.href ? (
          <a
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node
            }}
            href={tab.href}
            aria-current={selected ? 'page' : undefined}
            {...shared}
          >
            {body}
          </a>
        ) : (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            {...shared}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}

/** The panel of one tab. Render only the selected one, or pass `hidden`. */
export function TabPanel({
  panelId,
  id,
  hidden = false,
  children,
  className
}: {
  /** The same `panelId` given to `Tabs`. */
  panelId: string
  /** The tab id this panel belongs to. */
  id: string
  hidden?: boolean
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div
      role="tabpanel"
      id={tabPanelDomId(panelId, id)}
      aria-labelledby={tabDomId(panelId, id)}
      hidden={hidden}
      tabIndex={0}
      className={className ? `ui-tabpanel ${className}` : 'ui-tabpanel'}
    >
      {children}
    </div>
  )
}
