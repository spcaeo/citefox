// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PAGE_TABS, pageHash } from '../shell/routes'
import { PageTabs } from './PageTabs'
import { revealTab } from './tabStrip'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function tabs(): HTMLElement[] {
  return within(document.body).getAllByRole('tab')
}

describe('PageTabs', () => {
  it('renders every page tab in one tablist with a roving tabindex', () => {
    render(<PageTabs pageId="page-1" activeTab="markets" />)
    const list = within(document.body).getByRole('tablist', { name: 'Page sections' })
    expect(within(list).getAllByRole('tab')).toHaveLength(PAGE_TABS.length)
    const stops = tabs().filter((tab) => tab.tabIndex === 0)
    expect(stops).toHaveLength(1)
    expect(stops[0]?.textContent).toBe('Markets')
    expect(stops[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('moves with ArrowRight, ArrowLeft, Home and End and wraps at the ends', () => {
    render(<PageTabs pageId="page-1" activeTab="results" />)
    const [first] = tabs()
    if (!first) throw new Error('no tabs')
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(window.location.hash).toBe(pageHash('page-1', 'progress'))
    expect(document.activeElement?.textContent).toBe('Progress')

    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(window.location.hash).toBe(pageHash('page-1', 'history'))
    expect(document.activeElement?.textContent).toBe('History')

    fireEvent.keyDown(first, { key: 'End' })
    expect(window.location.hash).toBe(pageHash('page-1', 'history'))

    const last = tabs().at(-1)
    if (!last) throw new Error('no tabs')
    fireEvent.keyDown(last, { key: 'Home' })
    expect(window.location.hash).toBe(pageHash('page-1', 'results'))
    expect(document.activeElement?.textContent).toBe('Results')
  })

  it('ignores other keys', () => {
    window.location.hash = '#/start'
    render(<PageTabs pageId="page-1" activeTab="results" />)
    const [first] = tabs()
    if (!first) throw new Error('no tabs')
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    fireEvent.keyDown(first, { key: 'a' })
    expect(window.location.hash).toBe('#/start')
  })

  it('keeps the strip on one row that scrolls sideways', () => {
    render(<PageTabs pageId="page-1" activeTab="history" />)
    const list = within(document.body).getByRole('tablist')
    expect(list.classList.contains('ui-tabs')).toBe(true)
    expect(list.classList.contains('ui-tabs-scroll')).toBe(true)
    expect(list.classList.contains('tabs')).toBe(false)
    expect(tabs().every((tab) => tab.className === 'ui-tab')).toBe(true)
  })
})

describe('revealTab', () => {
  function strip(scrollLeft: number, width: number): HTMLElement {
    const box = document.createElement('div')
    Object.defineProperty(box, 'clientWidth', { value: width })
    box.scrollLeft = scrollLeft
    return box
  }
  function tab(left: number, width: number): HTMLElement {
    const node = document.createElement('a')
    Object.defineProperty(node, 'offsetLeft', { value: left })
    Object.defineProperty(node, 'offsetWidth', { value: width })
    return node
  }

  it('scrolls right just enough to show a tab past the right edge', () => {
    const box = strip(0, 500)
    revealTab(box, tab(600, 80))
    expect(box.scrollLeft).toBe(600 + 80 - 500 + 24)
  })

  it('scrolls left to show a tab before the left edge', () => {
    const box = strip(400, 500)
    revealTab(box, tab(100, 80))
    expect(box.scrollLeft).toBe(100 - 24)
  })

  it('leaves the strip alone when the tab is already visible', () => {
    const box = strip(100, 500)
    revealTab(box, tab(200, 80))
    expect(box.scrollLeft).toBe(100)
  })
})
