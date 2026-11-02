// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withoutEmptyColumns } from './columns'
import { COLUMNS, grid, QUESTIONS, type Question } from './ListGrid.fixtures'
import { SEARCH_TREE, searches, type Search } from './tree/tree.fixtures'
import { ListGrid } from './index'
import type { ListColumn } from './types'

afterEach(cleanup)

function headers(): string[] {
  return screen.getAllByRole('columnheader').map((cell) => cell.textContent ?? '')
}

/** A "Last run" column: empty for every row unless `ran` names it. */
function lastRun(
  ran: readonly string[] = [],
  rule: ListColumn<Question>['hideWhenEmpty'] = true
): ListColumn<Question> {
  const column: ListColumn<Question> = {
    id: 'run',
    label: 'Last run',
    width: 120,
    hideWhenEmpty: rule,
    sort: (row) => (ran.includes(row.id) ? 'Oct 29' : null),
    render: (row) => (ran.includes(row.id) ? 'Oct 29' : '—')
  }
  return column
}

describe('hideWhenEmpty (audit2 #14)', () => {
  it('leaves out a column no row fills, by its sort value', () => {
    render(grid({ columns: [...COLUMNS, lastRun()] }))
    expect(headers()).toEqual(['Q', 'Question', 'Stage', 'Win odds'])
  })

  it('shows the column once one row has a value', () => {
    render(grid({ columns: [...COLUMNS, lastRun(['q6'])] }))
    expect(headers()).toEqual(['Q', 'Question', 'Stage', 'Win odds', 'Last run'])
  })

  it('takes a value function, and counts "", "—" and null as empty', () => {
    const blanks = ['', '—', null, undefined, '  ']
    const rule = (row: Question): unknown => blanks[QUESTIONS.indexOf(row) % blanks.length]
    render(grid({ columns: [...COLUMNS, lastRun([], rule)] }))
    expect(headers()).not.toContain('Last run')
    cleanup()
    render(grid({ columns: [...COLUMNS, lastRun([], (row) => (row.n === 2 ? 0 : null))] }))
    expect(headers()).toContain('Last run')
  })

  it('checks every row, not only the ones a search shows', () => {
    render(grid({ columns: [...COLUMNS, lastRun(['q2'])], searchValue: 'clinic' }))
    expect(headers()).toContain('Last run')
  })

  it('keeps a column with no way to read its value, and every column with no rows', () => {
    const plain: ListColumn<Question> = { ...lastRun(), sort: false }
    expect(withoutEmptyColumns([...COLUMNS, plain], QUESTIONS)).toHaveLength(5)
    expect(withoutEmptyColumns([...COLUMNS, lastRun()], [])).toHaveLength(5)
    expect(withoutEmptyColumns(COLUMNS, QUESTIONS)).toBe(COLUMNS)
  })

  it('works in a tree grid too', () => {
    const empty: ListColumn<Search> = {
      id: 'note',
      label: 'Note',
      width: 120,
      hideWhenEmpty: () => null,
      render: () => '—'
    }
    const columns: ListColumn<Search>[] = [
      {
        id: 'text',
        label: 'Search',
        width: 'fill',
        sort: (row) => row.text,
        render: (row) => row.text
      },
      empty
    ]
    render(
      <ListGrid<Search>
        label="Searches"
        noun={['search', 'searches']}
        rows={searches(8)}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.text}
        columns={columns}
        tree={SEARCH_TREE}
        empty={<p>None</p>}
      />
    )
    expect(headers()).toEqual(['Search'])
  })
})

describe('hideWhenSame (owner 2026-10-30)', () => {
  /** A Status column: "New" on every row unless `moved` names it. */
  function status(moved: readonly string[] = []): ListColumn<Question> {
    return {
      id: 'status',
      label: 'Status',
      width: 96,
      hideWhenSame: true,
      sort: (row) => (moved.includes(row.id) ? 'Brief ready' : 'New'),
      render: (row) => (moved.includes(row.id) ? 'Brief ready' : 'New')
    }
  }

  it('leaves out a column whose rows all read the same', () => {
    render(grid({ columns: [...COLUMNS, status()] }))
    expect(headers()).not.toContain('Status')
  })

  it('shows it once one row differs, and keeps it for a single row', () => {
    render(grid({ columns: [...COLUMNS, status(['q6'])] }))
    expect(headers()).toContain('Status')
    cleanup()
    render(grid({ columns: [...COLUMNS, status()], rows: QUESTIONS.slice(0, 1) }))
    expect(headers()).toContain('Status')
  })

  it('takes a value function, and checks every row, not only the ones a search shows', () => {
    const stage: ListColumn<Question> = {
      id: 'stage2',
      label: 'Stage again',
      width: 96,
      hideWhenSame: (row) => row.stage,
      render: (row) => row.stage
    }
    render(grid({ columns: [...COLUMNS, stage], searchValue: 'clinic' }))
    expect(headers()).toContain('Stage again')
    cleanup()
    render(
      grid({
        columns: [...COLUMNS, stage],
        rows: QUESTIONS.slice(1, 2).concat(
          QUESTIONS.slice(1, 2).map((row) => ({ ...row, id: 'copy' }))
        )
      })
    )
    expect(headers()).not.toContain('Stage again')
  })
})

describe('defaultHidden', () => {
  beforeEach(() => window.localStorage.clear())
  const columns: ListColumn<Question>[] = COLUMNS.map((column) =>
    column.id === 'n' ? { ...column, defaultHidden: true } : column
  )

  it('starts hidden, stays in the Columns menu, and is remembered once shown', () => {
    const view = render(grid({ columns, columnsMenu: true, saveKey: 'ref-grid' }))
    expect(headers()).toEqual(['Question', 'Stage', 'Win odds'])
    fireEvent.click(view.getByRole('button', { name: /Columns/ }))
    const menu = view.getByRole('menu', { name: 'Columns' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Q: hidden' }))
    expect(headers()).toEqual(['Q', 'Question', 'Stage', 'Win odds'])
    cleanup()
    render(grid({ columns, columnsMenu: true, saveKey: 'ref-grid' }))
    expect(headers()).toEqual(['Q', 'Question', 'Stage', 'Win odds'])
  })
})
