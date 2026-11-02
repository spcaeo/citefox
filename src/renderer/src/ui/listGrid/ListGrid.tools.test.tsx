// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLUMNS, grid, many, shownQs, type Question } from './ListGrid.fixtures'
import { allNumeric, looksNumeric, setGridDevChecks } from './devChecks'
import type { ListColumn } from './types'
import { layoutStorageKey, parseLayout } from './useColumnLayout'
import { listUrlKeys, listUrlValues, parseListUrl } from './useListUrl'

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
}

function hashValue(key: string): string | null {
  const hash = window.location.hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get(key)
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/topics')
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  setGridDevChecks(false)
  vi.restoreAllMocks()
})

describe('ListGrid: state in the URL (R5)', () => {
  it('round-trips sort, search, page and Show all through the URL values', () => {
    const values = listUrlValues('qs', {
      search: 'email',
      sort: [{ key: 'odds', dir: 'desc' }],
      page: 3,
      all: true
    })
    expect(values).toEqual({ 'qs.q': 'email', 'qs.sort': 'odds:desc', 'qs.p': '3', 'qs.n': 'all' })
    const raw = listUrlKeys('qs')
      .map((key) => values[key] ?? '')
      .join('\u0000')
    expect(parseListUrl(raw)).toEqual({
      search: 'email',
      sort: [{ key: 'odds', dir: 'desc' }],
      page: 3,
      all: true
    })
    // The defaults leave no trace in the URL.
    expect(listUrlValues('qs', { search: '', sort: [], page: 1, all: false })).toEqual({
      'qs.q': null,
      'qs.sort': null,
      'qs.p': null,
      'qs.n': null
    })
  })

  it('writes a header sort and the page to the URL, and Back undoes them', async () => {
    const view = render(grid({ urlKey: 'qs', rows: many(30), pageSize: 10 }))
    fireEvent.click(view.getByRole('button', { name: /Win odds/ }))
    await settle()
    expect(hashValue('qs.sort')).toBe('odds:asc')
    fireEvent.click(view.getByRole('button', { name: 'Next page' }))
    await settle()
    expect(hashValue('qs.p')).toBe('2')
    expect(view.getByText('11–20 of 30')).toBeTruthy()

    window.history.back()
    await settle()
    expect(hashValue('qs.p')).toBeNull()
    expect(view.getByText('1–10 of 30')).toBeTruthy()
  })

  it('opens a copied link on the same sort, search and page', async () => {
    window.history.replaceState(null, '', '#/topics?qs.sort=n:desc&qs.q=Question&qs.p=2')
    const view = render(grid({ urlKey: 'qs', rows: many(30), pageSize: 10 }))
    expect((view.getByRole('searchbox') as HTMLInputElement).value).toBe('Question')
    expect(view.getByText('11–20 of 30')).toBeTruthy()
    expect(shownQs(view)[0]).toBe('Q20')
    // An old link with a column that is gone falls back to the grid's own sort.
    cleanup()
    window.history.replaceState(null, '', '#/topics?qs.sort=gone:asc')
    const again = render(grid({ urlKey: 'qs' }))
    expect(shownQs(again)[0]).toBe('Q6')
  })

  it('types the search in place and goes back to page 1', async () => {
    window.history.replaceState(null, '', '#/topics?qs.p=2')
    const view = render(grid({ urlKey: 'qs', rows: many(30), pageSize: 10 }))
    const before = window.history.length
    fireEvent.change(view.getByRole('searchbox'), { target: { value: 'number 1' } })
    await settle()
    expect(hashValue('qs.q')).toBe('number 1')
    expect(hashValue('qs.p')).toBeNull()
    expect(window.history.length).toBe(before)
  })
})

describe('ListGrid: column widths (R6)', () => {
  it('resizes a column from the keyboard, saves it, and resets on double-click', () => {
    const view = render(grid({ saveKey: 'test-grid' }))
    const edge = view.getByRole('separator', { name: 'Resize Stage column' })
    expect(edge.getAttribute('aria-valuenow')).toBe('96')
    fireEvent.keyDown(edge, { key: 'ArrowRight' })
    fireEvent.keyDown(edge, { key: 'ArrowRight' })
    expect(edge.getAttribute('aria-valuenow')).toBe('128')
    const row = view.container.querySelector<HTMLElement>('.ui-lg-row')
    expect(row?.style.gridTemplateColumns).toContain('128px')
    expect(parseLayout(window.localStorage.getItem(layoutStorageKey('test-grid')))).toEqual({
      widths: { stage: 128 },
      hidden: [],
      shown: []
    })

    // The next visit opens at the saved width.
    cleanup()
    const again = render(grid({ saveKey: 'test-grid' }))
    const saved = again.getByRole('separator', { name: 'Resize Stage column' })
    expect(saved.getAttribute('aria-valuenow')).toBe('128')
    fireEvent.doubleClick(saved)
    expect(saved.getAttribute('aria-valuenow')).toBe('96')
    expect(window.localStorage.getItem(layoutStorageKey('test-grid'))).toBeNull()
  })

  it('gives the main column no drag edge and keeps header names plain', () => {
    const view = render(grid())
    expect(view.queryByRole('separator', { name: 'Resize Question column' })).toBeNull()
    expect(view.getByRole('columnheader', { name: 'Stage' })).toBeTruthy()
  })

  it('drags a column edge and saves the width when the drag ends', async () => {
    const view = render(grid({ saveKey: 'drag-grid' }))
    const edge = view.getByRole('separator', { name: 'Resize Win odds column' })
    fireEvent.pointerDown(edge, { button: 0, clientX: 300, pointerId: 1 })
    expect(view.getByRole('region', { name: 'Questions' }).className).toContain('ui-lg-resizing')
    fireEvent.pointerMove(edge, { clientX: 340, pointerId: 1 })
    fireEvent.pointerUp(edge, { clientX: 340, pointerId: 1 })
    await settle()
    expect(view.getByRole('region', { name: 'Questions' }).className).not.toContain('resizing')
    const saved = parseLayout(window.localStorage.getItem(layoutStorageKey('drag-grid')))
    expect(saved.widths.odds).toBeGreaterThan(96)
  })

  it('reads bad saved data as the defaults', () => {
    expect(parseLayout('not json')).toEqual({ widths: {}, hidden: [], shown: [] })
    expect(parseLayout('{"widths":{"a":5,"b":"x"},"hidden":[1,"c"],"shown":["n",2]}')).toEqual({
      widths: { a: 48 },
      hidden: ['c'],
      shown: ['n']
    })
  })

  it('shows and hides columns from the shared Columns menu and remembers it', () => {
    const view = render(grid({ columnsMenu: true, saveKey: 'cols-grid' }))
    fireEvent.click(view.getByRole('button', { name: /Columns/ }))
    const menu = view.getByRole('menu', { name: 'Columns' })
    // The main column can't be hidden.
    expect(within(menu).queryByRole('menuitem', { name: /^Question/ })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Stage: shown' }))
    expect(view.queryByRole('columnheader', { name: 'Stage' })).toBeNull()
    cleanup()
    const again = render(grid({ columnsMenu: true, saveKey: 'cols-grid' }))
    expect(again.queryByRole('columnheader', { name: 'Stage' })).toBeNull()
    expect(again.getByRole('columnheader', { name: 'Win odds' })).toBeTruthy()
  })
})

describe('ListGrid: numbers, sorting and copy (R3, R4, R10)', () => {
  it('reads number text the way a cell shows it', () => {
    for (const text of ['1,204', '42%', '+11 pts', '−3', '$0.03', '1 / 2', '2–4', '7']) {
      expect(looksNumeric(text), text).toBe(true)
    }
    for (const text of ['Q6', 'Oct 19', 'Cited #2', 'Problem', '—']) {
      expect(looksNumeric(text), text).toBe(false)
    }
    expect(allNumeric(['12', '—', '4'])).toBe(true)
    expect(allNumeric(['—', ''])).toBe(false)
  })

  it('warns while developing when a number column is not marked numeric', async () => {
    setGridDevChecks(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const columns: ListColumn<Question>[] = [
      ...COLUMNS.filter((column) => column.id !== 'odds'),
      {
        id: 'odds',
        label: 'Win odds',
        width: 96,
        sort: (row) => row.odds,
        render: (row) => row.odds
      }
    ]
    render(grid({ columns }))
    await settle()
    const messages = warn.mock.calls.map((call) => String(call[0]))
    expect(messages.some((text) => text.includes('"odds" holds numbers'))).toBe(true)
    // Stage has no sort and no opt-out.
    expect(messages.some((text) => text.includes('"stage" can\'t be sorted'))).toBe(true)
    expect(messages.some((text) => text.includes('"n" holds numbers'))).toBe(false)
  })

  it('stays quiet for a marked grid and when the checks are off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(grid())
    await settle()
    expect(warn).not.toHaveBeenCalled()
  })

  it('right-aligns numeric headers and cells', () => {
    const view = render(grid())
    expect(view.getByRole('columnheader', { name: 'Win odds' }).className).toContain('ui-lg-end')
    const cell = view.container.querySelectorAll('.ui-lg-row')[0]?.querySelectorAll('.ui-lg-td')[3]
    expect(cell?.className).toContain('ui-lg-end')
    expect(cell?.className).toContain('num')
  })

  it('shows a faint sort icon on every sortable header and opts a column out', () => {
    const columns: ListColumn<Question>[] = [
      ...COLUMNS.map((column) =>
        column.id === 'stage' ? { ...column, sort: false as const } : column
      )
    ]
    const view = render(grid({ columns }))
    const odds = view.getByRole('columnheader', { name: 'Win odds' })
    expect(odds.querySelector('.ui-lg-arrow')).toBeTruthy()
    expect(view.getByRole('columnheader', { name: 'Stage' }).querySelector('button')).toBeNull()
  })

  it('adds the copy icon to a copy column and sorts it by the copy text', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const open = vi.fn()
    const columns: ListColumn<Question>[] = COLUMNS.map((column) =>
      column.id === 'text' ? { ...column, sort: undefined, copy: (row) => row.text } : column
    )
    const view = render(grid({ columns, onActivate: open }))
    const copy = view.getByRole('button', {
      name: 'Copy Text alerts for teams without a developer'
    })
    fireEvent.click(copy)
    await settle()
    expect(writeText).toHaveBeenCalledWith('Text alerts for teams without a developer')
    // Copying never opens the row.
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: /^Question/ }))
    expect(shownQs(view)[0]).toBe('Q21')
  })
})

describe('ListGrid: loading, errors and cut-off text (R13, R14)', () => {
  it('shows placeholder rows under the real header while loading', () => {
    const view = render(grid({ loading: true }))
    expect(view.getByRole('columnheader', { name: 'Win odds' })).toBeTruthy()
    expect(view.container.querySelectorAll('.ui-lg-row-loading')).toHaveLength(6)
    expect(view.queryByText('Q6')).toBeNull()
  })

  it('shows the shared error box with Retry', () => {
    const retry = vi.fn()
    const view = render(grid({ error: { message: 'The disk is full.', onRetry: retry } }))
    expect(view.getByRole('alert').textContent).toContain("Couldn't load the questions")
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })

  it('puts a cut-off cell’s full text in its tooltip', () => {
    const view = render(grid())
    const cell = view.container
      .querySelectorAll('.ui-lg-row')[0]
      ?.querySelectorAll<HTMLElement>('.ui-lg-td')[1]
    if (!cell) throw new Error('no cell')
    Object.defineProperty(cell, 'scrollWidth', { value: 400, configurable: true })
    Object.defineProperty(cell, 'clientWidth', { value: 120, configurable: true })
    fireEvent.mouseOver(cell)
    expect(cell.title).toBe('Three clinic locations; staff never open the staff app')
  })
})
