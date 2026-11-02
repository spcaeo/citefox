// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { grid } from './ListGrid.fixtures'
import type { FilterGroup } from './filters'
import { planToolbar } from './useToolbarFit'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('planToolbar (audit2 #7: Filter ▾ gathers the overflow)', () => {
  const base = {
    gap: 10,
    fixed: [200, 100],
    movable: [
      { id: 'a', width: 150 },
      { id: 'b', width: 120 }
    ],
    menu: { width: 90, own: false }
  }

  it('moves nothing while everything fits, or before the row is measured', () => {
    // 200 + 100 + 150 + 120 and three gaps.
    expect(planToolbar({ ...base, available: 600 })).toEqual([])
    expect(planToolbar({ ...base, available: 0 })).toEqual([])
  })

  it('moves the last filter first, counting the Filter ▾ button it brings', () => {
    // Without b: 200 + 100 + 150 + 90 (the button) and three gaps = 570.
    expect(planToolbar({ ...base, available: 570 })).toEqual(['b'])
    expect(planToolbar({ ...base, available: 569 })).toEqual(['a', 'b'])
  })

  it('counts a button the list shows anyway', () => {
    expect(planToolbar({ ...base, available: 600, menu: { width: 90, own: true } })).toEqual(['b'])
  })

  it('moves every filter when even that is not enough', () => {
    expect(planToolbar({ ...base, available: 100 })).toEqual(['a', 'b'])
  })
})

/** The toolbar row is `width` wide; the segmented filter 220, Market 160, Filter ▾ 100, the clear icon 28, search 200. */
function at(width: number): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains('ui-lg-bar') ? width : 900
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.dataset.lgMove === 'market') return 160
    if (this.dataset.lgMove !== undefined) return 220
    if (this.dataset.lgFilter !== undefined) return 100
    if (this.dataset.lgClear !== undefined) return 28
    return 80
  })
}

function setup(width: number, market = 'mkt-us'): { onMarket: ReturnType<typeof vi.fn> } {
  at(width)
  const onMarket = vi.fn()
  const marketGroup: FilterGroup = {
    id: 'market',
    label: 'Market',
    value: market,
    resetValue: 'mkt-us',
    choices: [
      { value: 'mkt-us', label: 'United States' },
      { value: 'mkt-uk', label: 'United Kingdom' }
    ],
    onChange: onMarket
  }
  const stageGroup: FilterGroup = {
    id: 'stage',
    label: 'Stage',
    value: 'all',
    resetValue: 'all',
    choices: [
      { value: 'all', label: 'All' },
      { value: 'Fit', label: 'Fit' }
    ],
    onChange: () => undefined
  }
  render(
    grid({
      filter: {
        label: 'Status',
        options: [
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' }
        ],
        value: 'all',
        onChange: () => undefined
      },
      filters: [stageGroup],
      filterControls: [marketGroup]
    })
  )
  return { onMarket }
}

const filterButton = (): HTMLElement => screen.getByRole('button', { name: /^Filter/ })

describe('ListToolbar: filters move into Filter ▾ when the row is full', () => {
  it('keeps every filter in the row while it fits', () => {
    // 200 + 220 + 160 + 100 and three 12px gaps = 716.
    setup(800)
    expect(screen.getByRole('combobox', { name: 'Market' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy()
  })

  it('moves Market first, and the button counts it while it is set', () => {
    setup(600, 'mkt-uk')
    expect(screen.queryByRole('combobox', { name: 'Market' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy()
    expect(filterButton().getAttribute('aria-label')).toBe('Filter, 1 set')
    fireEvent.click(filterButton())
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: 'Market: United Kingdom' })).toBeTruthy()
  })

  it('picks a moved filter from the menu', () => {
    const { onMarket } = setup(600)
    expect(filterButton().getAttribute('aria-label')).toBe('Filter')
    fireEvent.click(filterButton())
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Market: United Kingdom' }))
    expect(onMarket).toHaveBeenCalledWith('mkt-uk')
  })

  it('then moves the segmented filter, keeping the search in the row', () => {
    setup(400)
    expect(screen.queryByRole('group', { name: 'Status' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Market' })).toBeNull()
    expect(screen.getByRole('searchbox')).toBeTruthy()
    fireEvent.click(filterButton())
    expect(screen.getByRole('menuitemradio', { name: 'Status: Open' })).toBeTruthy()
  })

  it('keeps a segmented view switch marked stay in the row', () => {
    at(400)
    render(
      grid({
        filter: {
          label: 'View',
          options: [
            { value: 'all', label: 'All' },
            { value: 'tracked', label: 'Tracked' }
          ],
          value: 'all',
          onChange: () => undefined,
          stay: true
        }
      })
    )
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull()
  })
})
