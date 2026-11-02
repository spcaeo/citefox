// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GridSortKey } from '@shared/domain'
import { Button } from '../Button'
import { GROUP, QUESTIONS, RULES, grid, shownQs, type Question } from './ListGrid.fixtures'

afterEach(cleanup)

describe('ListGrid: sort, search, select, groups, filter', () => {
  it('cycles sort ascending, descending, off and reports aria-sort', () => {
    const view = render(grid())
    const header = view.getByRole('columnheader', { name: /Win odds/ })
    expect(header.getAttribute('aria-sort')).toBe('none')
    const sort = within(header).getByRole('button', { name: /Win odds/ })
    fireEvent.click(sort)
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(shownQs(view)).toEqual(['Q2', 'Q17', 'Q21', 'Q4', 'Q10', 'Q6'])
    fireEvent.click(sort)
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(shownQs(view)[0]).toBe('Q6')
    fireEvent.click(sort)
    expect(header.getAttribute('aria-sort')).toBe('none')
    expect(shownQs(view)).toEqual(['Q6', 'Q10', 'Q4', 'Q21', 'Q17', 'Q2'])
    // Unsortable column: plain text, no aria-sort.
    const stage = view.getByRole('columnheader', { name: 'Stage' })
    expect(stage.getAttribute('aria-sort')).toBeNull()
    expect(within(stage).queryByRole('button')).toBeNull()
  })

  it('searches, shows a no-match empty state, and Clear search brings rows back', () => {
    const view = render(grid())
    const box = view.getByRole('searchbox', { name: 'Search 6 questions' })
    fireEvent.change(box, { target: { value: 'email' } })
    expect(shownQs(view)).toEqual(['Q10', 'Q4', 'Q21'])
    fireEvent.change(box, { target: { value: 'pager alternative' } })
    expect(
      view.getByRole('heading', { name: 'No questions match “pager alternative”' })
    ).toBeTruthy()
    expect(view.queryByRole('grid')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Clear search' }))
    expect(shownQs(view)).toHaveLength(6)
    expect((box as HTMLInputElement).value).toBe('')
  })

  it('shows the caller empty node when there are no rows at all', () => {
    const view = render(grid({ rows: [] }))
    expect(view.getByText('No questions yet')).toBeTruthy()
    expect(view.queryByRole('grid')).toBeNull()
    expect(view.queryByRole('searchbox')).toBeNull()
  })

  it('selects rows, swaps the toolbar for the bulk bar, and Clear restores it', async () => {
    const bulk = vi.fn(({ selected }: { selected: readonly Question[] }) => (
      <Button size="sm">Draft fixes for {selected.length}</Button>
    ))
    const view = render(grid({ bulk }))
    const all = view.getByRole('checkbox', {
      name: 'Select every row on this page'
    }) as HTMLInputElement
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Q6' }))
    expect(all.indeterminate).toBe(true)
    expect(all.checked).toBe(false)
    expect(view.queryByRole('searchbox')).toBeNull()
    const bar = view.getByRole('region', { name: 'Bulk actions' })
    expect(within(bar).getByText('1 selected')).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Draft fixes for 1' })).toBeTruthy()
    expect(view.container.querySelector('[aria-selected="true"]')?.textContent).toContain('Q6')
    fireEvent.click(all)
    expect(all.checked).toBe(true)
    expect(all.indeterminate).toBe(false)
    expect(within(bar).getByText('6 selected')).toBeTruthy()
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear' }))
    expect(view.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    expect(view.getByRole('searchbox')).toBeTruthy()
  })

  it('keeps the count and Clear out of the wrapping actions, so Clear never drops a line', () => {
    const bulk = (): JSX.Element => (
      <>
        <Button size="sm">Move to cluster</Button>
        <Button size="sm">Move to new cluster</Button>
      </>
    )
    const view = render(grid({ bulk }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Q6' }))
    const bar = view.getByRole('region', { name: 'Bulk actions' })
    const actions = bar.querySelector('.ui-lg-bulk-actions') as HTMLElement
    expect(actions).toBeTruthy()
    expect(within(actions).getByRole('button', { name: 'Move to new cluster' })).toBeTruthy()
    expect(within(actions).getByRole('button', { name: /^Select all 6 questions$/ })).toBeTruthy()
    const clear = within(bar).getByRole('button', { name: 'Clear' })
    expect(actions.contains(clear)).toBe(false)
    expect(clear.parentElement).toBe(bar)
    expect(bar.lastElementChild).toBe(clear)
    expect(within(bar).getByText('1 selected').parentElement).toBe(bar)
  })

  it('groups rows under sticky headers with counts and meta, collapsible by click and Enter', () => {
    const view = render(grid({ group: { ...GROUP, collapsed: ['right'] } }))
    const toggle = view.getByRole('button', { name: 'Page exists, not cited' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const header = toggle.closest('[role="row"]') as HTMLElement
    expect(within(header).getByText('3')).toBeTruthy()
    expect(within(header).getByText('Improve the target page')).toBeTruthy()
    expect(
      view.getByRole('button', { name: 'Cited by the right page' }).getAttribute('aria-expanded')
    ).toBe('false')
    expect(shownQs(view)).toEqual(['Q6', 'Q10', 'Q4', 'Q21', 'Q17'])
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(shownQs(view)).toEqual(['Q21', 'Q17'])
    fireEvent.keyDown(header, { key: 'Enter' })
    expect(shownQs(view)).toEqual(['Q6', 'Q10', 'Q4', 'Q21', 'Q17'])
    expect(view.getByText('6 questions')).toBeTruthy()
  })

  it('filters with a caller-controlled segmented control and resets it from the empty state', async () => {
    function Filtered(): JSX.Element {
      const [stage, setStage] = useState('all')
      const rows = stage === 'all' ? QUESTIONS : QUESTIONS.filter((row) => row.stage === stage)
      return grid({
        rows,
        filter: {
          label: 'Stage',
          options: [
            { value: 'all', label: 'All stages' },
            { value: 'Fit', label: 'Fit' },
            { value: 'Compare', label: 'Compare' }
          ],
          value: stage,
          onChange: setStage
        },
        ai: <Button size="sm">AI</Button>,
        group: GROUP
      })
    }
    const view = render(<Filtered />)
    expect(view.getByRole('group', { name: 'Stage' })).toBeTruthy()
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Fit' }))
    expect(shownQs(view)).toEqual(['Q21', 'Q17'])
    fireEvent.click(view.getByRole('button', { name: 'Compare' }))
    // The filter emptied the list: the toolbar stays so the filter can be changed back.
    expect(view.getByRole('heading', { name: 'No questions match this filter' })).toBeTruthy()
    expect(view.queryByText('No questions yet')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Show all' }))
    expect(shownQs(view)).toHaveLength(6)
  })

  it('takes the sort and search from its caller (such as the URL) and reports changes', () => {
    const sorts: unknown[] = []
    const searches: string[] = []
    function Controlled(): JSX.Element {
      const [sort, setSort] = useState<readonly GridSortKey[]>([{ key: 'odds', dir: 'desc' }])
      const [search, setSearch] = useState('email')
      return grid({
        sort,
        onSortChange: (next) => {
          sorts.push(next)
          setSort(next)
        },
        searchValue: search,
        onSearchChange: (next) => {
          searches.push(next)
          setSearch(next)
        }
      })
    }
    const view = render(<Controlled />)
    const header = view.getByRole('columnheader', { name: /Win odds/ })
    expect(header.getAttribute('aria-sort')).toBe('descending')
    const box = view.getByRole('searchbox') as HTMLInputElement
    expect(box.value).toBe('email')
    expect(shownQs(view)).toHaveLength(3)
    fireEvent.click(within(header).getByRole('button', { name: /Win odds/ }))
    expect(sorts).toEqual([[]])
    expect(header.getAttribute('aria-sort')).toBe('none')
    fireEvent.change(box, { target: { value: '' } })
    expect(searches).toEqual([''])
    expect(shownQs(view)).toHaveLength(6)
  })
})
