import { useCallback, useEffect, useRef, type JSX, type KeyboardEvent } from 'react'
import { nextTabIndex } from '../shell/model'
import {
  PAGE_TABPANEL_ID,
  PAGE_TABS,
  navigateHash,
  pageHash,
  pageTabDomId,
  type PageTabId
} from '../shell/routes'
import { markOverflow, revealTab } from './tabStrip'

/**
 * The page's section tabs, in the v2 `Tabs` markup and classes (ui-tabs,
 * ui-tab) as links, so each tab has its URL: one row that scrolls sideways
 * when the window is narrow (it never wraps to a second row). Roving tabindex; ArrowLeft and
 * ArrowRight move and wrap, Home and End jump to the ends, and the active tab
 * is kept in view.
 */
export function PageTabs({
  pageId,
  activeTab
}: {
  pageId: string
  activeTab: PageTabId
}): JSX.Element {
  const pendingFocus = useRef<PageTabId | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const reveal = useCallback((id: PageTabId): void => {
    const strip = stripRef.current
    const tab = document.getElementById(pageTabDomId(id))
    if (!strip || !tab) return
    revealTab(strip, tab)
    markOverflow(strip)
  }, [])

  useEffect(() => {
    reveal(activeTab)
    if (pendingFocus.current !== activeTab) return
    pendingFocus.current = null
    document.getElementById(pageTabDomId(activeTab))?.focus({ preventScroll: true })
  }, [activeTab, reveal])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || typeof ResizeObserver === 'undefined') return
    // A narrower window can push the active tab out of view: bring it back.
    const observer = new ResizeObserver(() => reveal(activeTab))
    observer.observe(strip)
    return () => observer.disconnect()
  }, [activeTab, reveal])

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number): void {
    const next = nextTabIndex(index, PAGE_TABS.length, event.key)
    if (next === null) return
    const tab = PAGE_TABS[next]
    if (!tab) return
    event.preventDefault()
    pendingFocus.current = tab.id
    document.getElementById(pageTabDomId(tab.id))?.focus({ preventScroll: true })
    reveal(tab.id)
    navigateHash(pageHash(pageId, tab.id))
  }

  return (
    <div
      ref={stripRef}
      className="ui-tabs ui-tabs-scroll"
      role="tablist"
      aria-label="Page sections"
      onScroll={(event) => markOverflow(event.currentTarget)}
    >
      {PAGE_TABS.map((tab, index) => {
        const selected = tab.id === activeTab
        return (
          <a
            key={tab.id}
            id={pageTabDomId(tab.id)}
            className="ui-tab"
            role="tab"
            href={pageHash(pageId, tab.id)}
            aria-selected={selected}
            aria-current={selected ? 'page' : undefined}
            aria-controls={PAGE_TABPANEL_ID}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onFocus={() => reveal(tab.id)}
          >
            <span className="ui-tab-label" data-label={tab.label}>
              {tab.label}
            </span>
          </a>
        )
      })}
    </div>
  )
}
