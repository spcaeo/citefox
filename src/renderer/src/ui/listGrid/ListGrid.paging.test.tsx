// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUESTIONS, grid, many, shownQs } from './ListGrid.fixtures'

afterEach(cleanup)

describe('ListGrid: paging, menus, activation, keyboard, windowing', () => {
  it('pages with a footer count, next/previous and Show all', () => {
    const view = render(grid({ pageSize: 10, rows: many(26) }))
    expect(view.getByText('1–10 of 26')).toBeTruthy()
    const prev = view.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement
    const next = view.getByRole('button', { name: 'Next page' }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    fireEvent.click(next)
    expect(view.getByText('11–20 of 26')).toBeTruthy()
    fireEvent.click(next)
    expect(view.getByText('21–26 of 26')).toBeTruthy()
    expect(next.disabled).toBe(true)
    fireEvent.click(prev)
    expect(view.getByText('11–20 of 26')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Show all 26' }))
    expect(shownQs(view)).toHaveLength(26)
    expect(view.getByText('26 questions')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Next page' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Show fewer' }))
    expect(shownQs(view)).toHaveLength(10)
  })

  it('uses the caller summary line', () => {
    const view = render(
      grid({ summary: (info) => `${info.matching} keywords in ${info.total} rows` })
    )
    expect(view.getByText('6 keywords in 6 rows')).toBeTruthy()
  })

  it('opens the row menu with the row name and runs an action', () => {
    const see = vi.fn()
    const view = render(
      grid({
        rowMenu: (row) => [{ id: 'see', label: "See who's cited", onSelect: () => see(row.id) }]
      })
    )
    fireEvent.click(view.getByRole('button', { name: 'Actions for Q10' }))
    fireEvent.click(
      within(view.getByRole('menu', { name: 'Actions for Q10' })).getByRole('menuitem')
    )
    expect(see).toHaveBeenCalledWith('q10')
  })

  it('activates a row on Enter and on a click, but not from its checkbox or menu', () => {
    const onActivate = vi.fn()
    const view = render(
      grid({
        onActivate,
        bulk: () => null,
        rowMenu: () => [{ id: 'x', label: 'Keep as is', onSelect: vi.fn() }]
      })
    )
    const row = view
      .getByText('On-call maintenance crew changes every week')
      .closest('[role="row"]') as HTMLElement
    fireEvent.click(within(row).getByText('Fit'))
    expect(onActivate).toHaveBeenLastCalledWith(QUESTIONS[4])
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledTimes(2)
    fireEvent.click(within(row).getByRole('checkbox'))
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Q17' }))
    expect(onActivate).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(row, { key: ' ' })
    expect(row.getAttribute('aria-selected')).toBe('false')
  })

  it('moves focus between rows with the arrow keys', () => {
    const view = render(grid())
    const gridEl = view.getByRole('grid', { name: 'Questions' })
    act(() => gridEl.focus())
    fireEvent.keyDown(gridEl, { key: 'ArrowDown' })
    expect((document.activeElement as HTMLElement).dataset.line).toBe('0')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    expect((document.activeElement as HTMLElement).dataset.line).toBe('1')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' })
    expect((document.activeElement as HTMLElement).dataset.line).toBe('5')
  })

  it('renders a window of a 600-row list after Show all', () => {
    const view = render(grid({ rows: many(600) }))
    expect(view.getByText('1–25 of 600')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Show all 600' }))
    const rendered = view.container.querySelectorAll('.ui-lg-row').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)
    expect(view.getByRole('grid').getAttribute('aria-rowcount')).toBe('601')
  })

  it('fitPage draws a page in full with no inner scroll; Show all keeps the capped body', () => {
    const view = render(grid({ pageSize: 25, rows: many(60), fitPage: true, maxBodyHeight: 300 }))
    const body = view.getByRole('grid')
    expect(body.getAttribute('style')).toBeNull()
    expect(shownQs(view)).toHaveLength(25)
    fireEvent.click(view.getByRole('button', { name: 'Show all 60' }))
    expect(view.getByRole('grid').getAttribute('style')).toContain('max-height')
  })

  it('a controlled selection follows the keys it is given and reports changes', () => {
    const onSelectionChange = vi.fn()
    const bulk = vi.fn(({ selected }: { selected: readonly { id: string }[] }) => (
      <span data-testid="picked">{selected.map((row) => row.id).join(',')}</span>
    ))
    const view = render(grid({ bulk, selection: ['q10'], onSelectionChange }))
    expect(view.getByTestId('picked').textContent).toBe('q10')
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Q4' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.arrayContaining(['q10', 'q4']))
    // Not applied until the owner passes the new keys back.
    expect(view.getByTestId('picked').textContent).toBe('q10')
    view.rerender(grid({ bulk, selection: ['q10', 'q4'], onSelectionChange }))
    expect(view.getByTestId('picked').textContent).toContain('q4')
  })
})
