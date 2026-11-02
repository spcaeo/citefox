// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COLUMNS,
  QUESTIONS,
  RULES,
  grid,
  many,
  shownQs,
  type Props,
  type Question
} from './ListGrid.fixtures'
import type { ListColumn } from './types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function firstDrawnLine(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLElement>('.ui-lg-row')?.dataset.line
}

describe('ListGrid: row attributes, render-all, row detail, wrapping rows', () => {
  it('puts the caller data-* attributes on each row with its place among the rows shown', () => {
    const view = render(
      grid({
        rowProps: (row, index) => ({
          'data-drill-row': index,
          'data-stage': row.stage,
          'data-none': undefined
        })
      })
    )
    const rows = [...view.container.querySelectorAll<HTMLElement>('[data-drill-row]')]
    expect(rows.map((row) => row.getAttribute('data-drill-row'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5'
    ])
    expect(rows[0]?.getAttribute('role')).toBe('row')
    expect(rows[0]?.getAttribute('data-stage')).toBe('Problem')
    expect(rows[0]?.hasAttribute('data-none')).toBe(false)
    // The grid's own hooks still win over a caller's.
    expect(rows[0]?.dataset.line).toBe('0')
  })

  it('counts rows, not group headers, for the row index', () => {
    const view = render(
      grid({
        group: { key: (row) => ({ key: row.group, label: row.group }) },
        rowProps: (_row, index) => ({ 'data-at': index })
      })
    )
    const at = [...view.container.querySelectorAll<HTMLElement>('[data-at]')].map(
      (row) => row.dataset.at
    )
    expect(at).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(view.container.querySelectorAll('.ui-lg-group')).toHaveLength(3)
  })

  it('draws every row with virtualize={false} and no body height cap', () => {
    const view = render(grid({ rows: many(120), pageSize: 'all', virtualize: false }))
    expect(view.container.querySelectorAll('.ui-lg-row')).toHaveLength(120)
    expect((view.getByRole('grid') as HTMLElement).style.maxHeight).toBe('')
    // The default windows a Show all list longer than FIT_LINES_UP_TO.
    cleanup()
    const windowed = render(grid({ rows: many(400), pageSize: 'all' }))
    expect(windowed.container.querySelectorAll('.ui-lg-row').length).toBeLessThan(400)
  })

  it('draws a page, or a short Show all, in full with no scroll of its own (audit2 #6)', () => {
    const paged = render(grid({ rows: many(120), pageSize: 50 }))
    expect(paged.container.querySelectorAll('.ui-lg-row')).toHaveLength(50)
    expect((paged.getByRole('grid') as HTMLElement).style.maxHeight).toBe('')
    cleanup()
    const all = render(grid({ rows: many(120), pageSize: 'all' }))
    expect(all.container.querySelectorAll('.ui-lg-row')).toHaveLength(120)
    cleanup()
    // A caller's cap, or fitPage={false}, keeps the scroll box.
    const capped = render(grid({ rows: many(120), pageSize: 'all', maxBodyHeight: 300 }))
    expect((capped.getByRole('grid') as HTMLElement).style.maxHeight).toBe('340px')
    cleanup()
    const boxed = render(grid({ rows: many(60), pageSize: 50, fitPage: false }))
    expect((boxed.getByRole('grid') as HTMLElement).style.maxHeight).toBe('680px')
  })

  it('lets the page scroll and the header stick to it while the row fits', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    const view = render(grid())
    expect(view.container.querySelector('.ui-lg')?.classList.contains('ui-lg-page')).toBe(true)
    cleanup()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const narrow = render(grid())
    expect(narrow.container.querySelector('.ui-lg')?.classList.contains('ui-lg-page')).toBe(false)
  })

  it('hides a single-page footer with footer="paged" and keeps it while paged', () => {
    const view = render(grid({ footer: 'paged' }))
    expect(view.queryByText('6 questions')).toBeNull()
    cleanup()
    const paged = render(grid({ footer: 'paged', rows: many(30), pageSize: 10 }))
    expect(paged.getByText('1–10 of 30')).toBeTruthy()
    fireEvent.click(paged.getByRole('button', { name: 'Show all 30' }))
    expect(paged.getByRole('button', { name: 'Show fewer' })).toBeTruthy()
  })

  it('expands a row detail by its button, ArrowRight and ArrowLeft, and keeps clicks inside', async () => {
    const onActivate = vi.fn()
    const view = render(
      grid({
        onActivate,
        renderDetail: (row) => <p>Detail of {row.text}</p>,
        hasDetail: (row) => row.stage !== 'Decide',
        detailLabel: (row) => `the overview for Q${row.n}`
      })
    )
    expect(view.getByRole('columnheader', { name: 'Details' })).toBeTruthy()
    // Q2 (Decide) has nothing to expand.
    expect(view.queryByRole('button', { name: 'Show the overview for Q2' })).toBeNull()
    const toggle = view.getByRole('button', { name: 'Show the overview for Q10' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(onActivate).not.toHaveBeenCalled()
    const shown = view.getByRole('button', { name: 'Hide the overview for Q10' })
    expect(shown.getAttribute('aria-expanded')).toBe('true')
    const region = document.getElementById(shown.getAttribute('aria-controls') ?? '')
    expect(region?.textContent).toContain("Carrier's email-to-text address stopped delivering")
    expect(region?.closest('[role="row"]')).toBe(shown.closest('[role="row"]'))
    fireEvent.click(within(region as HTMLElement).getByText(/Detail of/))
    expect(onActivate).not.toHaveBeenCalled()
    expect((await axe.run(view.container, RULES)).violations).toEqual([])

    const row = shown.closest<HTMLElement>('[role="row"]') as HTMLElement
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    expect(view.getByRole('button', { name: 'Show the overview for Q10' })).toBeTruthy()
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(view.getByRole('button', { name: 'Hide the overview for Q10' })).toBeTruthy()
    // Rows still open on Enter.
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith(QUESTIONS[1])
  })

  it('names the expand button after the row by default', () => {
    const view = render(grid({ renderDetail: () => 'More' }))
    expect(view.getByRole('button', { name: 'Show details for Q6' })).toBeTruthy()
  })

  it('marks wrapping columns and rows, and top-aligns rows on request', () => {
    const columns: ListColumn<Question>[] = COLUMNS.map((column) =>
      column.id === 'text' ? { ...column, wrap: true } : column
    )
    const view = render(grid({ columns, rowAlign: 'start' }))
    const row = view.container.querySelector('.ui-lg-row') as HTMLElement
    expect(row.classList.contains('wrap')).toBe(true)
    expect(row.querySelectorAll('.ui-lg-td.wrap')).toHaveLength(1)
    expect(view.container.querySelector('.ui-lg')?.classList.contains('ui-lg-top')).toBe(true)
    expect(shownQs(view)).toHaveLength(6)
  })

  it('marks a row action column so its buttons show on hover or focus, and never sorts it', () => {
    const columns: ListColumn<Question>[] = [
      ...COLUMNS,
      {
        id: 'act',
        label: 'Action',
        hideLabel: true,
        width: 120,
        rowAction: true,
        render: (row) => <button type="button">Open {row.id}</button>
      }
    ]
    const view = render(grid({ columns }))
    const row = view.container.querySelector('.ui-lg-row') as HTMLElement
    const cell = row.querySelector('.ui-lg-td.ui-lg-action') as HTMLElement
    expect(cell).not.toBeNull()
    expect(within(cell).getByRole('button')).toBeTruthy()
    // No sort button in the header for the action column.
    expect(view.queryByRole('button', { name: /Action/ })).toBeNull()
  })

  it('takes a raw grid track for a column', () => {
    const columns: ListColumn<Question>[] = COLUMNS.map((column) =>
      column.id === 'stage' ? { ...column, track: 'minmax(72px, 0.6fr)' } : column
    )
    const view = render(grid({ columns }))
    const row = view.container.querySelector<HTMLElement>('.ui-lg-row') as HTMLElement
    expect(row.style.gridTemplateColumns).toContain('minmax(72px, 0.6fr)')
  })

  it('windows rows by their measured height, so tall rows do not skip when scrolled', () => {
    // Every row lays out at 88px, twice the 44px estimate.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.classList.contains('ui-lg-row') ? 88 : 0
    })
    const view = render(grid({ rows: many(400), pageSize: 'all' }))
    const scroller = view.getByRole('grid') as HTMLElement
    const body = scroller.querySelector<HTMLElement>('.ui-lg-inner > [role="rowgroup"]:last-child')
    expect(firstDrawnLine(view.container)).toBe('0')
    // 40px header + 10 rows of 88px: row 10 is at the top, 6 rows of overscan above it.
    act(() => {
      scroller.scrollTop = 40 + 880
      fireEvent.scroll(scroller)
    })
    expect(firstDrawnLine(view.container)).toBe('4')
    expect(body?.style.paddingTop).toBe(`${4 * 88}px`)
  })
})

describe('ListGrid: controlled selection', () => {
  it('shows the keys it is given and reports every tick, without keeping its own', () => {
    const onSelectionChange = vi.fn()
    const bulk: Props['bulk'] = ({ selected }) => (
      <span>{selected.map((row) => row.id).join(',')}</span>
    )
    const view = render(grid({ bulk, selection: ['q10', 'gone'], onSelectionChange }))
    const ten = view.getByRole('checkbox', { name: 'Select Q10' }) as HTMLInputElement
    expect(ten.checked).toBe(true)
    // A key with no row is not shown as selected.
    expect(view.getByText('q10')).toBeTruthy()
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Q6' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(['q10', 'gone', 'q6'])
    // Still the caller's value until it passes a new one.
    const six = view.getByRole('checkbox', { name: 'Select Q6' }) as HTMLInputElement
    expect(six.checked).toBe(false)
    view.rerender(grid({ bulk, selection: [], onSelectionChange }))
    expect(ten.checked).toBe(false)
  })
})

describe('ListGrid: controlled row detail', () => {
  it('opens the keys it is given and reports each toggle, without keeping its own', () => {
    const onExpandedChange = vi.fn()
    const renderDetail: Props['renderDetail'] = (row) => <p>Detail of {row.text}</p>
    const view = render(grid({ renderDetail, expanded: ['q10'], onExpandedChange }))
    expect(view.getByRole('button', { name: 'Hide details for Q10' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Show details for Q6' }))
    expect(onExpandedChange).toHaveBeenLastCalledWith(['q10', 'q6'])
    // Still the caller's value until it passes a new one.
    expect(view.getByRole('button', { name: 'Show details for Q6' })).toBeTruthy()
    view.rerender(grid({ renderDetail, expanded: ['q6'], onExpandedChange }))
    expect(view.getByRole('button', { name: 'Hide details for Q6' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Show details for Q10' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Hide details for Q6' }))
    expect(onExpandedChange).toHaveBeenLastCalledWith([])
  })
})
