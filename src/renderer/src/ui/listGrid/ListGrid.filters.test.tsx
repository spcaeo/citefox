// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FilterGroup } from './filters'
import { grid, QUESTIONS } from './ListGrid.fixtures'

afterEach(cleanup)

/** A list with one Stage filter in Filter ▾, filtering its rows like a screen does. */
function Filtered(): JSX.Element {
  const [stage, setStage] = useState('all')
  const filters: FilterGroup[] = [
    {
      id: 'stage',
      label: 'Stage',
      value: stage,
      resetValue: 'all',
      onChange: setStage,
      choices: [
        { value: 'all', label: 'All', count: QUESTIONS.length },
        { value: 'Problem', label: 'Problem', count: 2 },
        { value: 'Nothing', label: 'Nothing here', count: 0 }
      ]
    }
  ]
  const rows = stage === 'all' ? QUESTIONS : QUESTIONS.filter((row) => row.stage === stage)
  return grid({ rows, filters })
}

function pick(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
}

describe('ListGrid: one Filter ▾ button (audit2 #7)', () => {
  it('lists each filter as a group with a tick on the picked choice and its count', () => {
    render(<Filtered />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const all = screen.getByRole('menuitemradio', { name: 'Stage: All' })
    expect(all.getAttribute('aria-checked')).toBe('true')
    expect(all.textContent).toContain('6')
    expect(screen.queryByRole('menuitem', { name: 'Clear filters' })).toBeNull()
  })

  it('filters, shows how many are set, and clears from the menu', () => {
    const view = render(<Filtered />)
    pick('Stage: Problem')
    expect(view.container.querySelectorAll('.ui-lg-row')).toHaveLength(2)
    // The menu stays open while someone picks; the button names the count.
    expect(screen.getByRole('button', { name: 'Filter, 1 set' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear filters' }))
    expect(view.container.querySelectorAll('.ui-lg-row')).toHaveLength(6)
  })

  it('a clear icon shows while a filter or search is set and resets both', () => {
    const view = render(<Filtered />)
    const clear = (): HTMLElement | null =>
      screen.queryByRole('button', { name: 'Clear filters and search' })
    expect(clear()).toBeNull()
    pick('Stage: Problem')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sms' } })
    fireEvent.click(clear() as HTMLElement)
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
    expect(view.container.querySelectorAll('.ui-lg-row')).toHaveLength(6)
    expect(clear()).toBeNull()
  })

  it('an emptied list offers Show all, which resets the filters', () => {
    const view = render(<Filtered />)
    pick('Stage: Nothing here')
    expect(screen.getByText('No questions match this filter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(view.container.querySelectorAll('.ui-lg-row')).toHaveLength(6)
  })
})
