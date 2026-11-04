// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatList,
  formatSort,
  parseList,
  parseSort,
  readQueryValue,
  useGridQueryState,
  useQueryChoice,
  useQuerySortChoice,
  useQueryState,
  writeQuery
} from './queryState'

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/pages?view=grid')
})

afterEach(() => cleanup())

describe('query values', () => {
  it('reads one value, treating empty as missing', () => {
    expect(readQueryValue('#/pages?q=sms&f=', 'q')).toBe('sms')
    expect(readQueryValue('#/pages?q=sms&f=', 'f')).toBeNull()
    expect(readQueryValue('#/pages', 'q')).toBeNull()
  })

  it('round-trips lists and sorts, dropping what it cannot read', () => {
    expect(parseList(' a, ,b,c ')).toEqual(['a', 'b', 'c'])
    expect(formatList([])).toBeNull()
    expect(formatList(['a', 'b'])).toBe('a,b')
    expect(parseSort('pos:asc,odds:desc,bad,name:up')).toEqual([
      { key: 'pos', dir: 'asc' },
      { key: 'odds', dir: 'desc' }
    ])
    expect(formatSort([{ key: 'pos', dir: 'asc' }])).toBe('pos:asc')
    expect(formatSort([])).toBeNull()
  })

  it('writes in place by default and as a new entry on push', async () => {
    const length = window.history.length
    writeQuery({ q: 'sms' })
    expect(window.location.hash).toBe('#/pages?view=grid&q=sms')
    expect(window.history.length).toBe(length)
    writeQuery({ view: null, f: 'cited' }, 'push')
    await settle()
    expect(window.location.hash).toBe('#/pages?q=sms&f=cited')
    expect(window.history.length).toBe(length + 1)
  })
})

describe('useQueryState', () => {
  function Probe(): JSX.Element {
    const [view, setView] = useQueryState('view')
    return (
      <button type="button" onClick={() => setView(view === 'grid' ? 'cards' : 'grid')}>
        {view ?? 'none'}
      </button>
    )
  }

  it('follows the URL and writes back to it', async () => {
    render(<Probe />)
    expect(screen.getByRole('button').textContent).toBe('grid')
    act(() => screen.getByRole('button').click())
    expect(window.location.hash).toBe('#/pages?view=cards')
    expect(screen.getByRole('button').textContent).toBe('cards')
    window.location.hash = '#/pages'
    await settle()
    expect(screen.getByRole('button').textContent).toBe('none')
  })
})

describe('useGridQueryState', () => {
  let grid: ReturnType<typeof useGridQueryState> | null = null
  function Probe(): JSX.Element {
    grid = useGridQueryState('drill')
    return <p>{grid.search}</p>
  }

  it('keeps search, filter, sort and selection under one prefix', async () => {
    render(<Probe />)
    act(() => grid?.setSearch('sms'))
    act(() => grid?.setSort([{ key: 'odds', dir: 'desc' }]))
    act(() => grid?.setSelection(['p1', 'p2']))
    expect(window.location.hash).toBe(
      '#/pages?view=grid&drill.q=sms&drill.sort=odds%3Adesc&drill.pick=p1%2Cp2'
    )
    expect(grid?.listProps.searchValue).toBe('sms')
    expect(grid?.listProps.sort).toEqual([{ key: 'odds', dir: 'desc' }])
    expect(grid?.selection).toEqual(['p1', 'p2'])
    const length = window.history.length
    act(() => grid?.setFilter('cited'))
    await settle()
    // A filter is a step Back undoes; typing is not.
    expect(window.history.length).toBe(length + 1)
    expect(grid?.filter).toBe('cited')
    act(() => grid?.setSearch(''))
    expect(window.location.hash).not.toContain('drill.q')
  })
})

describe('useQueryChoice', () => {
  const IDS = ['all', 'open', 'done'] as const
  function Probe(): JSX.Element {
    const [value, setValue] = useQueryChoice('x.f', IDS, 'all')
    return (
      <div>
        <p>{value}</p>
        <button type="button" onClick={() => setValue('open')}>
          open
        </button>
        <button type="button" onClick={() => setValue('all')}>
          all
        </button>
      </div>
    )
  }

  it('keeps the default out of the URL and steps through Back', async () => {
    render(<Probe />)
    expect(screen.getByText('all', { selector: 'p' })).toBeTruthy()
    const length = window.history.length
    act(() => screen.getByText('open', { selector: 'button' }).click())
    await settle()
    expect(window.location.hash).toBe('#/pages?view=grid&x.f=open')
    expect(window.history.length).toBe(length + 1)
    act(() => screen.getByText('all', { selector: 'button' }).click())
    await settle()
    expect(window.location.hash).toBe('#/pages?view=grid')
  })

  it('opens the value in a pasted link and ignores an unknown one', async () => {
    window.location.hash = '#/pages?x.f=done'
    render(<Probe />)
    expect(screen.getByText('done', { selector: 'p' })).toBeTruthy()
    window.location.hash = '#/pages?x.f=nonsense'
    await settle()
    expect(screen.getByText('all', { selector: 'p' })).toBeTruthy()
  })
})

describe('useQuerySortChoice', () => {
  const KEYS = ['rank', 'name'] as const
  let current: ReturnType<typeof useQuerySortChoice<(typeof KEYS)[number]>> | null = null
  function Probe(): JSX.Element {
    current = useQuerySortChoice('x.sort', KEYS)
    return <p>{current[0] ? `${current[0].key}/${current[0].down}` : 'none'}</p>
  }

  it('writes name:dir, reads it back and clears it', async () => {
    render(<Probe />)
    expect(screen.getByText('none')).toBeTruthy()
    act(() => current?.[1]({ key: 'name', down: true }))
    expect(window.location.hash).toBe('#/pages?view=grid&x.sort=name%3Adesc')
    expect(screen.getByText('name/true')).toBeTruthy()
    window.location.hash = '#/pages?x.sort=bad%3Aasc'
    await settle()
    expect(screen.getByText('none')).toBeTruthy()
    act(() => current?.[1](null))
    expect(window.location.hash).not.toContain('x.sort')
  })
})
