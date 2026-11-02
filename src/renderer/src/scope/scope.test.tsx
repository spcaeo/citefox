// @vitest-environment happy-dom
import { useState, type JSX } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import { ItemPicker, PICKER_ROW_CAP } from './ItemPicker'
import { ScopeChooser } from './ScopeChooser'
import {
  costLine,
  describeScope,
  estimateSearches,
  parseIds,
  parseScope,
  resolveScopeIds,
  scopeParams
} from './model'
import type { PickerItem, Scope, ScopeOptions, ScopePage } from './types'

afterEach(cleanup)

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: 'mkt-uk', country: 'GB' }

function page(id: string, overrides: Partial<ScopePage> = {}): ScopePage {
  return {
    id,
    url: `https://textbolt.com/blog/${id}/`,
    label: `Page ${id}`,
    folder: 'blog',
    status: 'tracked',
    tracked: true,
    groupIds: [],
    clusterIds: [],
    marketIds: ['mkt-us'],
    promptCount: 4,
    samples: 1,
    nextCheckAt: '2026-10-20T00:00:00.000Z',
    score: 40,
    pageCited: 1,
    aioPrompts: 3,
    ...overrides
  }
}

const OPTIONS: ScopeOptions = {
  projectId: 'p1',
  domain: 'textbolt.com',
  pages: [
    page('a', { groupIds: ['g1'], clusterIds: ['c1'], marketIds: ['mkt-us', 'mkt-uk'] }),
    page('b', { groupIds: ['g1'], nextCheckAt: '2026-11-20T00:00:00.000Z' }),
    page('c', { status: 'not_tracked', tracked: false, nextCheckAt: null, clusterIds: ['c1'] }),
    page('d', { status: 'paused', clusterIds: ['c2'] })
  ],
  groups: [{ id: 'g1', name: 'Money pages', kind: 'group', count: 2 }],
  clusters: [
    { id: 'c1', name: 'Email', kind: 'cluster', count: 2 },
    { id: 'c2', name: 'Reminders', kind: 'cluster', count: 1 }
  ],
  topics: [{ id: 't1', name: '10DLC', kind: 'topic', count: 0, questions: 6 }],
  views: [],
  markets: [US, UK],
  defaultMarketId: 'mkt-us',
  searchesLeft: 100
}
const NOW = new Date('2026-10-23T00:00:00.000Z')

describe('scope model', () => {
  it('reads and writes the scope on the URL with a prefix', () => {
    const scope = parseScope(
      { 'check.scope': 'group', 'check.ids': 'g1,g1,bad id,g2' },
      'check',
      'due'
    )
    expect(scope).toEqual({ kind: 'group', ids: ['g1', 'g2'] })
    expect(scopeParams(scope, 'check')).toEqual({ 'check.scope': 'group', 'check.ids': 'g1,g2' })
    expect(scopeParams({ kind: 'due', ids: ['x'] }, 'check')).toEqual({
      'check.scope': 'due',
      'check.ids': null
    })
    expect(parseScope({ 'check.scope': 'nope' }, 'check', 'due').kind).toBe('due')
    expect(parseScope({ 'x.scope': 'view' }, 'x', 'project', ['project', 'pages']).kind).toBe(
      'project'
    )
    expect(parseIds('a,,b, c')).toEqual(['a', 'b', 'c'])
  })

  it('resolves each kind to page ids', () => {
    const ids = (scope: Scope): string[] => resolveScopeIds(scope, OPTIONS, NOW)
    expect(ids({ kind: 'due', ids: [] })).toEqual(['a'])
    expect(ids({ kind: 'tracked', ids: [] })).toEqual(['a', 'b', 'd'])
    expect(ids({ kind: 'pages', ids: ['b', 'zz'] })).toEqual(['b'])
    expect(ids({ kind: 'group', ids: ['g1'] })).toEqual(['a', 'b'])
    expect(ids({ kind: 'cluster', ids: ['c1', 'c2'] })).toEqual(['a', 'c', 'd'])
    expect(ids({ kind: 'topic', ids: ['t1'] })).toEqual(['t1'])
  })

  it('estimates searches per page, market and question limit', () => {
    expect(estimateSearches(OPTIONS, ['a', 'b'], null)).toEqual({ min: 12, max: 24, pages: 2 })
    expect(estimateSearches(OPTIONS, ['a', 'b'], ['mkt-uk'])).toEqual({ min: 4, max: 8, pages: 1 })
    expect(estimateSearches(OPTIONS, ['a'], null, () => 1)).toEqual({ min: 2, max: 4, pages: 1 })
    expect(estimateSearches(OPTIONS, ['t1'], null)).toEqual({ min: 12, max: 24, pages: 1 })
    expect(costLine({ min: 12, max: 24, pages: 2 }, 100)).toBe(
      'About 12–24 searches · 100 left this month'
    )
    expect(costLine({ min: 80, max: 160, pages: 2 }, 100)).toBe(
      'About 80–160 searches · only 100 left this month'
    )
  })

  it('describes a scope in plain words', () => {
    expect(describeScope({ kind: 'cluster', ids: ['c1', 'c2'] }, OPTIONS)).toBe(
      'Email + 1 more cluster'
    )
    expect(describeScope({ kind: 'pages', ids: ['a'] }, OPTIONS)).toBe('1 page')
    expect(describeScope({ kind: 'group', ids: [] }, OPTIONS)).toBe('No groups picked')
  })
})

function PickerHarness({ items }: { items: PickerItem[] }): JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  return (
    <>
      <ItemPicker
        label="Pages"
        items={items}
        selected={picked}
        onChange={setPicked}
        noun={['page', 'pages']}
      />
      <output data-testid="picked">{picked.join(',')}</output>
    </>
  )
}

describe('ItemPicker', () => {
  const many: PickerItem[] = Array.from({ length: 2014 }, (_, index) => ({
    id: `p${index}`,
    label: `Page ${index}`,
    detail: `/blog/${index}/`
  }))

  it('names its search box by the noun, so the name stays put as the count changes', () => {
    render(<PickerHarness items={many} />)
    const box = screen.getByRole('searchbox', { name: 'Search pages' })
    expect(box.getAttribute('placeholder')).toBe('Search 2,014 pages')
  })

  it('draws a capped window of 2,000 rows and narrows by search', () => {
    render(<PickerHarness items={many} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(PICKER_ROW_CAP)
    expect(screen.getByText(/Showing 150 of 2,014/)).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Page 201' } })
    // Every word matches anywhere: 201, 1201 and 2010–2013.
    expect(screen.getAllByRole('checkbox')).toHaveLength(6)
  })

  it('picks every match, not only the drawn rows, and clears', () => {
    render(<PickerHarness items={many} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick all 2,014' }))
    expect(screen.getByTestId('picked').textContent?.split(',')).toHaveLength(2014)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('picked').textContent).toBe('')
    fireEvent.click(screen.getByRole('checkbox', { name: /Page 3$/ }))
    expect(screen.getByTestId('picked').textContent).toBe('p3')
  })

  it('does not pick a disabled row', () => {
    render(
      <PickerHarness items={[{ id: 'x', label: 'Login', disabledReason: 'Not tracked yet' }]} />
    )
    const box = screen.getByRole('checkbox', { name: /Login/ })
    expect((box as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Pick all/ })).toHaveProperty('disabled', true)
  })
})

describe('ScopeChooser', () => {
  it('lists kinds with counts and switches to the picker', () => {
    function Harness(): JSX.Element {
      const [scope, setScope] = useState<Scope>({ kind: 'due', ids: [] })
      return (
        <>
          <ScopeChooser
            options={OPTIONS}
            value={scope}
            onChange={setScope}
            kinds={['due', 'tracked', 'pages', 'group', 'cluster', 'topic', 'view']}
            legend="What to check"
            now={NOW}
          />
          <output data-testid="scope">{`${scope.kind}:${scope.ids.join(',')}`}</output>
        </>
      )
    }
    render(<Harness />)
    // No saved views: the kind is left out.
    expect(screen.queryByRole('radio', { name: /A saved view/ })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /A cluster/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Email/ }))
    expect(screen.getByTestId('scope').textContent).toBe('cluster:c1')
  })

  it('puts a leading choice first, and shows its own content when it is picked', () => {
    function Harness(): JSX.Element {
      const [lead, setLead] = useState(true)
      const [scope, setScope] = useState<Scope>({ kind: 'project', ids: [] })
      return (
        <>
          <ScopeChooser
            options={OPTIONS}
            value={scope}
            onChange={(next) => {
              setLead(false)
              setScope(next)
            }}
            kinds={['pages', 'group', 'project']}
            legend="What to export"
            leading={{
              label: 'This page',
              checked: lead,
              onSelect: () => setLead(true),
              children: <p>One page picker</p>
            }}
            now={NOW}
          />
          <output data-testid="scope">{lead ? 'lead' : scope.kind}</output>
        </>
      )
    }
    render(<Harness />)
    const radios = screen.getAllByRole('radio')
    expect(radios[0]?.closest('label')?.textContent).toContain('This page')
    expect((radios[0] as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /Whole project/ }) as HTMLInputElement).checked).toBe(
      false
    )
    expect(screen.getByText('One page picker')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Whole project/ }))
    expect(screen.getByTestId('scope').textContent).toBe('project')
    expect(screen.queryByText('One page picker')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /This page/ }))
    expect(screen.getByTestId('scope').textContent).toBe('lead')
  })
})
