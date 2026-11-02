import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { PageSummary, ThemePreference } from '@shared/domain'
import { signalGuide } from '../guide/signals'
import { UiIcon } from '../ui/UiIcon'
import { pageSearchPreviewLabel } from '../projects/copy'
import { openDrawer } from './drawers'
import { openTrackPage } from './pickerDrawers/model'
import { navigateHash, pageHash } from './routes'
import {
  SEARCH_LABEL,
  SEARCH_PLACEHOLDER,
  SEARCH_TIP,
  createGroup,
  isSearchShortcut,
  matchTopics,
  searchGroups,
  searchLabel,
  shortcutHint,
  type SearchOption
} from './search'
import { findCatalog, findData } from './searchRank'
import type { SidebarTopic } from './sidebarTopics'
import { createSearchDataSource, useSearchData, type SearchDataSource } from './useSearchData'
import type { QuestionMatches } from './useShellSearch'
import './topBarSearch.css'

/**
 * The ⌘K "find anything" box in the top bar (Main.dc.html): every screen,
 * settings tab and action (the catalog, matched here with everyday words such
 * as "keys" or "dark mode"), the open project's topics (from the sidebar's
 * list), its competitors, fixes and report schedules (read once when the box
 * opens), pages through `pages:search` and questions through `search:questions`
 * (both debounced by the shell). Only pages and questions ask main per query.
 * Empty, it shows what to type. A drawer result opens over the screen open now.
 *
 * It is an ARIA combobox with a grouped listbox (the APG "listbox with grouped
 * options" shape): focus stays in the box while ArrowDown and ArrowUp move the
 * active option across every group (wrapping), `aria-activedescendant` names
 * it, Enter opens it, and Escape clears the box. Each group is a `group` named
 * by its visible heading, so a screen reader says "Questions" on entering it.
 * Options are links with `role="option"`, so a click opens them natively.
 */
export function TopBarSearch({
  projectId = null,
  foundPageCount,
  query,
  onQuery,
  pages,
  questions,
  topics,
  onTheme,
  dataSource
}: {
  /** The open project, for its competitors, fixes and reports. */
  projectId?: string | null
  foundPageCount: number
  query: string
  onQuery: (query: string) => void
  /** Matching pages, null while the search runs. */
  pages: readonly PageSummary[] | null
  /** Matching questions, null while the search runs. */
  questions: QuestionMatches | null
  topics: readonly SidebarTopic[]
  /** "Switch theme to …": picks and saves the look. */
  onTheme?: (theme: ThemePreference) => void
  /** Tests only. Production reads through the preload bridge. */
  dataSource?: SearchDataSource
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const listboxId = `${baseId}-results`
  const [open, setOpen] = useState(false)
  // A key, not an index: results arriving later must not move the highlight to another row.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const trimmed = query.trim()
  const source = useMemo(() => dataSource ?? createSearchDataSource(), [dataSource])
  const extra = useSearchData(projectId, source)
  const searching = pages === null || questions === null
  // Drawer results open over the screen open now (read at each render, so it is current).
  const here = typeof window === 'undefined' ? '' : window.location.hash
  const found = trimmed
    ? searchGroups({
        ...findCatalog(trimmed, here),
        topics: matchTopics(topics, trimmed),
        pages,
        questions: questions?.hits ?? null,
        ...findData(trimmed, extra.data, here)
      })
    : []
  const nothing = !searching && found.length === 0
  // Nothing matches: offer to make it instead (a topic, a page, questions).
  const groups = nothing && trimmed.length > 0 ? [createGroup(trimmed)] : found
  const options = groups.flatMap((group) => group.options)
  const activeIndex = options.findIndex((option) => option.key === activeKey)
  const active = activeIndex >= 0 ? options[activeIndex] : undefined
  const optionId = (index: number): string => `${baseId}-option-${index}`
  const activeId = active ? optionId(activeIndex) : null
  const showing = open && trimmed.length > 0
  const listed = showing && options.length > 0
  const pagesMore = pages ? pageSearchPreviewLabel(pages.length) : null

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (!isSearchShortcut(event)) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the active option in view when the arrows move past the popup's scroll edge.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeId])

  function picked(): void {
    setOpen(false)
    setActiveKey(null)
    onQuery('')
    signalGuide('search-used')
  }

  /** Opens a result: a link, a "Create" option's drawer, or a look. */
  function choose(option: SearchOption): void {
    picked()
    if (option.theme) onTheme?.(option.theme)
    else if (option.create === 'new-topic') openDrawer('new-topic')
    else if (option.create === 'add-questions') openDrawer('add-questions')
    else if (option.create === 'track-page') {
      openTrackPage(trimmed, {
        onResult: (pageId) => {
          if (typeof pageId === 'string') navigateHash(pageHash(pageId, 'prompts'))
        }
      })
    } else navigateHash(option.href)
  }

  function move(step: 1 | -1): void {
    if (options.length === 0) return
    const from = activeIndex < 0 ? (step === 1 ? -1 : 0) : activeIndex
    const next = (from + step + options.length) % options.length
    setActiveKey(options[next]?.key ?? null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        setOpen(true)
        move(event.key === 'ArrowDown' ? 1 : -1)
        return
      case 'Enter':
        if (!listed || !active) return
        event.preventDefault()
        choose(active)
        return
      case 'Escape':
        event.preventDefault()
        setActiveKey(null)
        onQuery('')
        return
      default:
        return
    }
  }

  // Each group's first option index in the flat list the arrows walk.
  const starts = groups.map((_, at) =>
    groups.slice(0, at).reduce((sum, group) => sum + group.options.length, 0)
  )
  return (
    <div
      className="topbar-search-wrap"
      ref={wrapRef}
      data-guide="topbar-search"
      onFocus={() => {
        // Opening the box reads the project's competitors, fixes and reports once.
        if (!open) extra.load()
        setOpen(true)
      }}
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <label className="topbar-search" title={searchLabel(foundPageCount)}>
        <UiIcon name="search" size={14} />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          placeholder={SEARCH_PLACEHOLDER}
          aria-label={SEARCH_LABEL}
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listed ? listboxId : undefined}
          aria-activedescendant={listed && activeId ? activeId : undefined}
          aria-keyshortcuts="Meta+K Control+K"
          value={query}
          onChange={(event) => {
            setOpen(true)
            setActiveKey(null)
            onQuery(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="topbar-search-key" aria-hidden="true">
          {shortcutHint()}
        </kbd>
      </label>
      {open && trimmed.length === 0 ? (
        <div className="topbar-results topbar-tips" data-testid="search-tips">
          <p className="topbar-tip">{SEARCH_TIP}</p>
          <p className="faint">↑ ↓ to move · Enter to open · Esc to clear</p>
        </div>
      ) : null}
      {showing ? (
        <div className="topbar-results">
          {listed ? (
            <div role="listbox" id={listboxId} aria-label="Search results">
              {groups.map((group, at) => {
                const headingId = `${baseId}-${group.id}`
                return (
                  <div
                    key={group.id}
                    role="group"
                    aria-labelledby={headingId}
                    className="topbar-group"
                    data-group={group.id}
                  >
                    <div role="presentation" id={headingId} className="topbar-group-head">
                      {group.heading}
                    </div>
                    {group.options.map((option, row) => {
                      const index = (starts[at] ?? 0) + row
                      const selected = index === activeIndex
                      if (option.create || option.theme) {
                        return (
                          <div
                            key={option.key}
                            id={optionId(index)}
                            role="option"
                            aria-selected={selected}
                            tabIndex={-1}
                            className="topbar-option"
                            data-active={selected ? 'true' : undefined}
                            data-create={option.create}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(option)}
                          >
                            <span className="topbar-result-text">{option.text}</span>
                            {option.detail ? (
                              <span className="topbar-option-detail">{option.detail}</span>
                            ) : null}
                          </div>
                        )
                      }
                      return (
                        <a
                          key={option.key}
                          id={optionId(index)}
                          role="option"
                          aria-selected={selected}
                          tabIndex={-1}
                          href={option.href}
                          className="topbar-option"
                          data-active={selected ? 'true' : undefined}
                          // Keep focus in the box, so its blur never closes the list mid-click.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={picked}
                        >
                          <span className="topbar-result-text">{option.text}</span>
                          {option.detail ? (
                            <span className="topbar-option-detail">{option.detail}</span>
                          ) : null}
                        </a>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ) : null}
          {searching ? (
            <p className="faint" role="status">
              Searching pages and questions…
            </p>
          ) : null}
          {nothing ? (
            <p className="faint">Nothing matches. Try other words, or create it:</p>
          ) : null}
          {questions?.failed ? <p className="faint">Could not search questions.</p> : null}
          {pagesMore ? <p className="faint">{`${pagesMore} pages`}</p> : null}
          {questions?.more ? (
            <p className="faint">
              {`Showing the first ${questions.hits.length} questions. Type more words to narrow them.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
