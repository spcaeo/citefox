// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListGrid } from '../index'
import type { ListGridProps } from '../types'
import { SEARCH_COLUMNS, SEARCH_TREE, searches, type Search } from './tree.fixtures'

afterEach(cleanup)
beforeEach(() => {
  window.history.replaceState(null, '', '#/topics/t1')
  window.localStorage.clear()
})

function grid(props: Partial<ListGridProps<Search>> = {}): ReturnType<typeof render> {
  return render(
    <ListGrid<Search>
      label="Searches"
      noun={['search', 'searches']}
      rows={props.rows ?? searches(40)}
      rowKey={(row) => row.id}
      rowLabel={(row) => `S${row.n}`}
      columns={SEARCH_COLUMNS}
      tree={SEARCH_TREE}
      search={{ text: (row) => row.text }}
      empty={<p>No searches yet</p>}
      {...props}
    />
  )
}

function lineTexts(view: ReturnType<typeof render>): string[] {
  return [...view.container.querySelectorAll<HTMLElement>('[role="rowgroup"] > [data-line]')].map(
    (line) => {
      const level = line.getAttribute('aria-level') ?? '?'
      const first = line.querySelector('[role="gridcell"]')?.textContent?.trim() ?? ''
      return `${level}:${first}`
    }
  )
}

function groupRow(view: ReturnType<typeof render>, label: string): HTMLElement {
  const rows = [...view.container.querySelectorAll<HTMLElement>('[data-group]')]
  const row = rows.find((item) => item.textContent?.includes(label))
  if (!row) throw new Error(`no group ${label}`)
  return row
}

function setHash(hash: string): void {
  act(() => {
    window.history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('ListGrid tree', () => {
  it('starts closed: one row per top group, with totals in the normal columns', () => {
    const view = grid()
    expect(view.getByRole('treegrid')).toBeTruthy()
    expect(lineTexts(view)).toEqual(['1:Problem', '1:Solution', '1:Compare', '1:Decide'])
    const problem = groupRow(view, 'Problem')
    expect(problem.getAttribute('aria-expanded')).toBe('false')
    const cells = within(problem).getAllByRole('gridcell')
    expect(cells[1]?.textContent).toBe('10')
    expect(cells[2]?.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(
      /3 not cited, 3 your other page, 2 right page cited, 2 no AI Overview/
    )
    expect(cells[3]?.textContent).toBe('6')
  })

  it('adds up in a footer total row, and every group adds up to its parent', () => {
    const view = grid()
    const total = view.container.querySelector('.ui-lg-tree-total')
    const cells = within(total as HTMLElement).getAllByRole('gridcell')
    expect(cells.map((cell) => cell.textContent)).toEqual(['Total', '40', '', '24', 'up to 98'])
    const groups = [...view.container.querySelectorAll('[data-group]')]
    const sum = groups.reduce(
      (n, row) => n + Number(row.querySelectorAll('[role="gridcell"]')[1]?.textContent),
      0
    )
    expect(sum).toBe(40)
    expect(view.getByText('40 searches')).toBeTruthy()
  })

  it('opens a group with its arrow, shows 3 leaves, then "Show N more"', () => {
    const view = grid()
    fireEvent.click(within(groupRow(view, 'Problem')).getByRole('button', { name: 'Open Problem' }))
    expect(lineTexts(view).slice(0, 6)).toEqual([
      '1:Problem',
      '2:Not cited',
      '2:Your other page',
      '2:Right page',
      '2:No AI Overview',
      '1:Solution'
    ])
    fireEvent.click(groupRow(view, 'Not cited'))
    const texts = lineTexts(view)
    expect(texts.slice(1, 6)).toEqual([
      '2:Not cited',
      '3:Search 1: how do I get Nagios alerts by text fast',
      '3:Search 17: how do I get Nagios alerts by text',
      '3:Search 33: how do I get Nagios alerts by text',
      '2:Your other page'
    ])
  })

  it('caps long groups with "Show N more", which reveals the rest', () => {
    const view = grid({ rows: searches(160) })
    fireEvent.click(groupRow(view, 'Problem'))
    fireEvent.click(groupRow(view, 'Not cited'))
    const more = view.getByRole('button', { name: /Show 7 more/ })
    expect(more.textContent).toContain('searches in Not cited')
    fireEvent.click(more)
    expect(view.queryByRole('button', { name: /Show 7 more/ })).toBeNull()
    expect(view.container.querySelectorAll('.ui-lg-tree-leaf')).toHaveLength(10)
  })

  it('starts closed even for a small tree, whose Expand all shows every leaf', () => {
    const view = grid({ rows: searches(30) })
    expect(lineTexts(view)).toEqual(['1:Problem', '1:Solution', '1:Compare', '1:Decide'])
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(view.container.querySelectorAll('.ui-lg-tree-leaf')).toHaveLength(30)
    expect(view.queryByRole('button', { name: /more/ })).toBeNull()
    // Closing one group keeps the others open.
    fireEvent.click(groupRow(view, 'Problem'))
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('false')
    expect(groupRow(view, 'Solution').getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a lone top group, which would otherwise be one line', () => {
    const view = grid({ rows: searches(40).filter((row) => row.stage === 'Problem') })
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('true')
    expect(groupRow(view, 'Not cited').getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the groups defaultOpen names while the URL names none, with "Show N more"', () => {
    const view = grid({
      rows: searches(160),
      urlKey: 'fx',
      tree: { ...SEARCH_TREE, defaultOpen: (group) => group.depth === 0 && group.key !== 'Decide' }
    })
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('true')
    expect(groupRow(view, 'Compare').getAttribute('aria-expanded')).toBe('true')
    expect(groupRow(view, 'Decide').getAttribute('aria-expanded')).toBe('false')
    // Closing one keeps the other default-open groups open, now in the URL.
    fireEvent.click(groupRow(view, 'Solution'))
    expect(groupRow(view, 'Solution').getAttribute('aria-expanded')).toBe('false')
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('true')
    const open = new URLSearchParams(window.location.hash.split('?')[1]).get('fx.open') ?? ''
    expect(open.split(',')).toHaveLength(2)
    // A URL with open groups wins over the default.
    setHash('#/topics/t1?fx.open=-')
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('false')
    cleanup()
    // Leaves under an open default group stop at 3 and "Show N more".
    window.history.replaceState(null, '', '#/topics/t1')
    const fixes = grid({ rows: searches(160), tree: { ...SEARCH_TREE, defaultOpen: () => true } })
    expect(fixes.getAllByRole('button', { name: /Show 7 more/ }).length).toBeGreaterThan(0)
  })

  it('has Expand all and Collapse all', () => {
    const view = grid()
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(
      [...view.container.querySelectorAll('[data-group]')].every(
        (row) => row.getAttribute('aria-expanded') === 'true'
      )
    ).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Collapse all' }))
    expect(lineTexts(view)).toHaveLength(4)
  })

  it('keeps open groups in the URL with opaque ids, and follows Back', () => {
    const view = grid({ urlKey: 'tree' })
    fireEvent.click(groupRow(view, 'Compare'))
    const open = new URLSearchParams(window.location.hash.split('?')[1]).get('tree.open') ?? ''
    expect(open).toMatch(/^g[a-z0-9]+$/)
    expect(window.location.hash).not.toContain('Compare')
    setHash('#/topics/t1?tree.open=*')
    expect(view.container.querySelectorAll('[aria-expanded="false"][data-group]')).toHaveLength(0)
    setHash('#/topics/t1')
    expect(lineTexts(view)).toHaveLength(4)
    setHash(`#/topics/t1?tree.open=${open}`)
    expect(groupRow(view, 'Compare').getAttribute('aria-expanded')).toBe('true')
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('false')
  })

  it('folds and unfolds with Left and Right, and Enter opens a leaf', () => {
    const onActivate = vi.fn()
    const view = grid({ onActivate })
    const problem = groupRow(view, 'Problem')
    fireEvent.keyDown(problem, { key: 'ArrowRight' })
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(groupRow(view, 'Problem'), { key: 'ArrowLeft' })
    expect(groupRow(view, 'Problem').getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(groupRow(view, 'Problem'), { key: 'Enter' })
    fireEvent.keyDown(groupRow(view, 'Not cited'), { key: 'ArrowRight' })
    const leaf = view.container.querySelector<HTMLElement>('.ui-lg-tree-leaf')
    expect(leaf).not.toBeNull()
    fireEvent.keyDown(leaf as HTMLElement, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
    // Left on a leaf goes up to its group.
    act(() => {
      fireEvent.keyDown(leaf as HTMLElement, { key: 'ArrowLeft' })
    })
    expect(document.activeElement).toBe(groupRow(view, 'Not cited'))
  })

  it('opens every group while searching, with only the matching leaves', () => {
    const view = grid()
    fireEvent.change(view.getByRole('searchbox'), { target: { value: 'fast' } })
    const leaves = view.container.querySelectorAll('.ui-lg-tree-leaf')
    expect(leaves.length).toBe(6)
    expect(view.queryByRole('button', { name: 'Expand all' })).toBeNull()
    const total = view.container.querySelector('.ui-lg-tree-total')
    expect(total?.querySelectorAll('[role="gridcell"]')[1]?.textContent).toBe('6')
  })

  it('sorts siblings from the header, groups by their totals', () => {
    const view = grid({ rows: searches(30) })
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(view.getByRole('button', { name: /Win odds/ }))
    fireEvent.click(view.getByRole('button', { name: /Win odds/ }))
    const tops = [...view.container.querySelectorAll<HTMLElement>('.ui-lg-tree-l0')].map((row) =>
      Number(/up to (\d+)/.exec(row.textContent ?? '')?.[1])
    )
    expect([...tops].sort((a, b) => b - a)).toEqual(tops)
    const first = groupRow(view, 'Not cited')
    const leaves: number[] = []
    let next = first.nextElementSibling
    while (next?.classList.contains('ui-lg-tree-leaf')) {
      leaves.push(Number(next.querySelectorAll('[role="gridcell"]')[4]?.textContent))
      next = next.nextElementSibling
    }
    expect([...leaves].sort((a, b) => b - a)).toEqual(leaves)
  })

  it('keeps ListGrid features: placeholder rows, Columns menu, resize edges, selection', () => {
    const loading = grid({ loading: true })
    expect(loading.container.querySelectorAll('.ui-lg-row-loading')).toHaveLength(6)
    cleanup()
    const onBulk = vi.fn(() => null)
    const view = grid({ columnsMenu: true, bulk: onBulk, rows: searches(12) })
    expect(view.getByRole('button', { name: /Columns/ })).toBeTruthy()
    expect(view.getAllByRole('separator').length).toBeGreaterThan(0)
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Select S1' }))
    expect(view.getByText('1 selected')).toBeTruthy()
  })

  it('indents leaves past their group label', () => {
    const view = grid({ rows: searches(8) })
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    const leaf = view.container.querySelector<HTMLElement>('.ui-lg-tree-leaf [role="gridcell"]')
    expect(leaf?.style.paddingLeft).toBe('68px')
    expect(
      groupRow(view, 'Not cited').querySelector<HTMLElement>('.ui-lg-tree-cell')?.style.paddingLeft
    ).toBe('24px')
  })

  it('renders 2,000 leaves collapsed in under 100 ms', () => {
    const rows = searches(2000)
    // Warm up React and the module graph once.
    grid({ rows: searches(50) })
    cleanup()
    // The best of three, so a busy machine's pause is not counted as the grid's.
    let best = Infinity
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now()
      const view = grid({ rows })
      best = Math.min(best, performance.now() - started)
      expect(lineTexts(view)).toHaveLength(4)
      cleanup()
    }
    expect(best).toBeLessThan(100)
  })
})
