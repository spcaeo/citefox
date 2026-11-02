// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COLUMNS, grid, GROUP, type Question } from './ListGrid.fixtures'
import { pinPlan } from './pin'
import type { ListColumn } from './types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const cols = (...extra: ListColumn<Question>[]): ListColumn<Question>[] => [...extra, ...COLUMNS]

describe('pinPlan (audit2 #6: the first text column stays in place)', () => {
  it('pins the columns up to the main text column, each where it already sits', () => {
    const plan = pinPlan(COLUMNS, false)
    expect(plan.select).toBeNull()
    expect([...plan.columns.keys()]).toEqual(['n', 'text'])
    expect(plan.columns.get('n')).toEqual({ left: 0, first: true, last: false })
    // Q is 48 wide after the 16px padding; the Question ground starts half a gap before its track.
    expect(plan.columns.get('text')).toEqual({
      left: 'calc(64px + 0.5 * var(--lg-gap, 16px))',
      first: false,
      last: true
    })
  })

  it('pins the tick box column first', () => {
    const plan = pinPlan(COLUMNS, true)
    expect(plan.select).toEqual({ left: 0, first: true, last: false })
    expect(plan.columns.get('n')?.left).toBe('calc(32px + 0.5 * var(--lg-gap, 16px))')
    expect(plan.columns.get('text')?.left).toBe('calc(80px + 1.5 * var(--lg-gap, 16px))')
  })

  it('pins a tree arrow column when it is named', () => {
    const plan = pinPlan(COLUMNS, false, 'n')
    expect([...plan.columns.keys()]).toEqual(['n'])
    expect(plan.columns.get('n')?.last).toBe(true)
  })

  it('turns off with pin: false, and pin: true picks another column', () => {
    const off = COLUMNS.map((column) => (column.id === 'text' ? { ...column, pin: false } : column))
    expect(pinPlan(off, true).columns.size).toBe(0)
    expect(pinPlan(off, true).select).toBeNull()
    const other = COLUMNS.map((column) => (column.id === 'n' ? { ...column, pin: true } : column))
    expect([...pinPlan(other, false).columns.keys()]).toEqual(['n'])
  })

  it('pins only the main column when one before it has a flexible track', () => {
    const plan = pinPlan(
      cols({ id: 'flex', label: 'Flex', width: 72, track: 'minmax(72px, 1fr)', render: () => '' }),
      true
    )
    expect(plan.select).toBeNull()
    expect([...plan.columns.keys()]).toEqual(['text'])
    expect(plan.columns.get('text')).toEqual({ left: 0, first: false, last: true })
  })

  it('pins nothing without a main text column', () => {
    expect(
      pinPlan(
        COLUMNS.filter((column) => column.width !== 'fill'),
        true
      ).columns.size
    ).toBe(0)
  })
})

describe('ListGrid: the pinned column', () => {
  it('marks the header, rows and tick boxes, and only the last cell casts the edge', () => {
    const view = render(grid({ bulk: () => null, group: GROUP }))
    const section = view.container.querySelector('.ui-lg')
    expect(section?.classList.contains('ui-lg-pins')).toBe(true)
    const head = screen.getAllByRole('columnheader')
    expect(head.map((cell) => cell.classList.contains('ui-lg-pin'))).toEqual([
      true,
      true,
      true,
      false,
      false
    ])
    expect(head[2]?.classList.contains('ui-lg-pin-last')).toBe(true)
    expect(head[0]?.classList.contains('ui-lg-pin-first')).toBe(true)
    const row = view.container.querySelector('.ui-lg-row')
    const cells = [...(row?.querySelectorAll('[role="gridcell"]') ?? [])] as HTMLElement[]
    expect(cells.map((cell) => cell.classList.contains('ui-lg-pin'))).toEqual([
      true,
      true,
      true,
      false,
      false
    ])
    expect(cells[2]?.style.left).toBe('calc(80px + 1.5 * var(--lg-gap, 16px))')
  })

  it('shows the edge only while scrolled sideways', () => {
    render(grid())
    const box = screen.getByRole('grid')
    expect(box.hasAttribute('data-scrolled-x')).toBe(false)
    box.scrollLeft = 40
    fireEvent.scroll(box)
    expect(box.hasAttribute('data-scrolled-x')).toBe(true)
    box.scrollLeft = 0
    fireEvent.scroll(box)
    expect(box.hasAttribute('data-scrolled-x')).toBe(false)
  })

  it('pins nothing when the main column opts out', () => {
    const columns = COLUMNS.map((column) =>
      column.id === 'text' ? { ...column, pin: false } : column
    )
    const view = render(grid({ columns }))
    expect(view.container.querySelector('.ui-lg-pin')).toBeNull()
    expect(view.container.querySelector('.ui-lg-pins')).toBeNull()
  })
})
