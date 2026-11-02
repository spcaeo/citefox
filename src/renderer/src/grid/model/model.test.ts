import { describe, expect, test } from 'vitest'
import type { GridViewState } from '@shared/domain'
import { membershipColumn, membershipGroup } from '../columns'
import type { GridColumn, GridGroupOption } from '../types'
import { csvRequest } from './csv'
import { csvFileName, emptyReason, showingLabel, sortButtonLabel } from './labels'
import {
  buildRowIndex,
  facetOptions,
  matchingIndices,
  pageSlice,
  sortIndices,
  tableLines,
  treeLines
} from './rows'
import {
  activeFilterCount,
  clampWidth,
  clearSearchAndFilters,
  initialGridState,
  sameView,
  setPrimarySort,
  setRange,
  sortByColumn,
  toggleFacetValue
} from './state'

interface Row {
  id: string
  title: string
  folder: string
  score: number | null
  status: string
  clusters: { id: string; name: string }[] | null
}

const ROWS: Row[] = [
  { id: 'a', title: 'Text alerts', folder: 'blog', score: 50, status: 'tracked', clusters: null },
  { id: 'b', title: 'Bulk SMS pricing', folder: '', score: 31, status: 'tracked', clusters: null },
  {
    id: 'c',
    title: 'Opt-in rules',
    folder: 'blog',
    score: null,
    status: 'setting_up',
    clusters: null
  },
  { id: 'd', title: 'Churches', folder: 'industries', score: 18, status: 'paused', clusters: null },
  {
    id: 'e',
    title: 'Alerts vs marketing',
    folder: 'blog',
    score: 16,
    status: 'tracked',
    clusters: null
  }
]

const COLUMNS: GridColumn<Row>[] = [
  {
    id: 'page',
    label: 'Page',
    fixed: true,
    width: 300,
    sort: (r) => r.title,
    render: (r) => r.title,
    csv: (r) => r.title
  },
  {
    id: 'folder',
    label: 'Folder',
    width: 120,
    sort: (r) => r.folder || null,
    filter: { kind: 'facet', values: (r) => [r.folder], label: (v) => v || '(No folder)' },
    render: (r) => r.folder,
    csv: (r) => r.folder
  },
  {
    id: 'score',
    label: 'Score',
    width: 100,
    sort: (r) => r.score,
    defaultDir: 'desc',
    filter: { kind: 'range', value: (r) => r.score },
    render: (r) => r.score,
    csv: (r) => r.score
  },
  {
    id: 'status',
    label: 'Status',
    width: 100,
    hiddenByDefault: true,
    sort: (r) => r.status,
    filter: {
      kind: 'facet',
      values: (r) => [r.status],
      order: ['tracked', 'setting_up', 'paused']
    },
    render: (r) => r.status,
    csv: (r) => r.status
  }
]

const BASE: GridViewState = initialGridState(COLUMNS)
const index = (): ReturnType<typeof buildRowIndex<Row>> => buildRowIndex(ROWS, (r) => r.title)
const ids = (list: readonly number[]): string[] => list.map((at) => ROWS[at]?.id ?? '?')

describe('grid state (FR-21.1, FR-21.2)', () => {
  test('hides default-hidden columns, toggles facets, ranges, and clears', () => {
    expect(BASE.hidden).toEqual(['status'])
    let state = toggleFacetValue(BASE, 'folder', 'blog')
    state = toggleFacetValue(state, 'folder', '')
    state = setRange(state, 'score', { min: 20, below: null })
    expect(activeFilterCount(state)).toBe(3)
    state = toggleFacetValue(state, 'folder', 'blog')
    expect(state.filters).toEqual({ folder: [''] })
    expect(setRange(state, 'score', { min: null, below: null }).ranges).toEqual({})
    expect(clearSearchAndFilters({ ...state, search: 'x' })).toMatchObject({
      search: '',
      filters: {},
      ranges: {}
    })
  })

  test('click sorts one column; Shift-click adds a second; the menu puts a column first', () => {
    let state = sortByColumn(BASE, 'folder', false)
    state = sortByColumn(state, 'score', true)
    expect(state.sort).toEqual([
      { key: 'folder', dir: 'asc' },
      { key: 'score', dir: 'asc' }
    ])
    expect(sortByColumn(state, 'score', false).sort).toEqual([{ key: 'score', dir: 'desc' }])
    expect(setPrimarySort(BASE, COLUMNS, 'score').sort).toEqual([{ key: 'score', dir: 'desc' }])
    expect(setPrimarySort(state, COLUMNS, 'score').sort[0]).toEqual({ key: 'score', dir: 'asc' })
  })

  test('compares views field by field and clamps widths', () => {
    const a = { ...BASE, filters: { folder: ['blog'], status: ['tracked'] } }
    const b = { ...BASE, filters: { status: ['tracked'], folder: ['blog'] } }
    expect(sameView(a, b)).toBe(true)
    expect(sameView(a, { ...b, density: 'compact' })).toBe(false)
    const column = COLUMNS[1] as GridColumn<Row>
    expect(clampWidth(column, 10)).toBe(48)
    expect(clampWidth(column, 5000)).toBe(960)
  })
})

describe('row pipeline (FR-21.1, FR-21.4, NFR-12)', () => {
  test('search matches title text, facets and ranges combine, null scores drop out of ranges', () => {
    const rows = index()
    expect(ids(matchingIndices(rows, { ...BASE, search: 'ALERT' }, COLUMNS))).toEqual(['a', 'e'])
    const state = setRange(toggleFacetValue(BASE, 'folder', 'blog'), 'score', {
      min: 20,
      below: null
    })
    expect(ids(matchingIndices(rows, state, COLUMNS))).toEqual(['a'])
    expect(
      ids(matchingIndices(rows, setRange(BASE, 'score', { min: null, below: 31 }), COLUMNS))
    ).toEqual(['d', 'e'])
  })

  test('facet counts reflect the search and the other filters, not their own', () => {
    const rows = index()
    const state = toggleFacetValue(
      setRange(BASE, 'score', { min: 17, below: null }),
      'folder',
      'blog'
    )
    const folder = facetOptions(rows, state, COLUMNS, COLUMNS[1] as GridColumn<Row>)
    expect(folder.map((option) => [option.label, option.count, option.checked])).toEqual([
      ['(No folder)', 1, false],
      ['blog', 1, true],
      ['industries', 1, false]
    ])
    const status = facetOptions(rows, state, COLUMNS, COLUMNS[3] as GridColumn<Row>)
    expect(status.map((option) => [option.value, option.count])).toEqual([
      ['tracked', 1],
      ['setting_up', 0],
      ['paused', 0]
    ])
  })

  test('multi-key sort keeps empty values last in either direction and ties stable', () => {
    const rows = index()
    const all = [0, 1, 2, 3, 4]
    expect(ids(sortIndices(rows, all, [{ key: 'score', dir: 'desc' }], COLUMNS))).toEqual([
      'a',
      'b',
      'd',
      'e',
      'c'
    ])
    expect(ids(sortIndices(rows, all, [{ key: 'score', dir: 'asc' }], COLUMNS))).toEqual([
      'e',
      'd',
      'b',
      'a',
      'c'
    ])
    expect(
      ids(
        sortIndices(
          rows,
          all,
          [
            { key: 'folder', dir: 'asc' },
            { key: 'score', dir: 'desc' }
          ],
          COLUMNS
        )
      )
    ).toEqual(['a', 'e', 'c', 'd', 'b'])
  })

  test('pages 10/25/50 or all, and groups by option with whole-group counts', () => {
    expect(pageSlice(186, 25, 1)).toEqual({ page: 1, pages: 8, start: 0, end: 25 })
    expect(pageSlice(186, 25, 99)).toEqual({ page: 8, pages: 8, start: 175, end: 186 })
    expect(pageSlice(186, 'all', 3)).toEqual({ page: 1, pages: 1, start: 0, end: 186 })
    const rows = index()
    const byFolder: GridGroupOption<Row> = {
      id: 'folder',
      label: 'Folder',
      key: (r) => ({ key: r.folder, label: r.folder || '(No folder)' })
    }
    const { lines } = tableLines(rows, [0, 1, 2, 3, 4], byFolder, pageSlice(5, 10, 1), new Set())
    expect(
      lines.map((line) =>
        line.kind === 'group' ? `#${line.label}:${line.count}` : ROWS[line.index]?.id
      )
    ).toEqual(['#(No folder):1', 'b', '#blog:3', 'a', 'c', 'e', '#industries:1', 'd'])
    const collapsed = tableLines(
      rows,
      [0, 1, 2, 3, 4],
      byFolder,
      pageSlice(5, 10, 1),
      new Set(['blog'])
    )
    expect(collapsed.lines.filter((line) => line.kind === 'row')).toHaveLength(2)
  })

  test('tree opens the first node, or every node while filtering', () => {
    const rows = index()
    const byFolder: GridGroupOption<Row> = {
      id: 'folder',
      label: 'Folder',
      key: (r) => ({ key: r.folder, label: r.folder || '(No folder)' })
    }
    const closed = treeLines(rows, [0, 1, 2, 3, 4], byFolder, null, false)
    expect(closed.lines.filter((line) => line.kind === 'leaf')).toHaveLength(1)
    const open = treeLines(rows, [0, 1, 2, 3, 4], byFolder, null, true)
    expect(open.lines.filter((line) => line.kind === 'leaf')).toHaveLength(5)
    expect(open.open.size).toBe(3)
  })

  test('indexes 2,014 rows and filters and sorts them well under 300 ms', () => {
    const many: Row[] = Array.from({ length: 2014 }, (_, at) => ({
      id: `p${at}`,
      title: `Page ${at} about SMS ${at % 7 === 0 ? 'pricing' : 'alerts'}`,
      folder: ['blog', 'features', 'industries', ''][at % 4] ?? '',
      score: at % 5 === 0 ? null : at % 100,
      status: ['tracked', 'setting_up', 'paused', 'not_tracked'][at % 4] ?? 'tracked',
      clusters: null
    }))
    const started = performance.now()
    const rows = buildRowIndex(many, (r) => r.title)
    const matched = matchingIndices(
      rows,
      toggleFacetValue({ ...BASE, search: 'pricing' }, 'folder', 'blog'),
      COLUMNS
    )
    const sorted = sortIndices(
      rows,
      matchingIndices(rows, BASE, COLUMNS),
      [
        { key: 'folder', dir: 'asc' },
        { key: 'score', dir: 'desc' }
      ],
      COLUMNS
    )
    facetOptions(rows, BASE, COLUMNS, COLUMNS[1] as GridColumn<Row>)
    const elapsed = performance.now() - started
    expect(matched.length).toBeGreaterThan(0)
    expect(sorted).toHaveLength(2014)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('labels and CSV (FR-21.5, FR-21.6, FR-21.7)', () => {
  test('always says how many rows it shows of how many', () => {
    const noun = ['page', 'pages'] as const
    expect(showingLabel(25, 186, 186, noun)).toBe('Showing 25 of 186 pages')
    expect(showingLabel(186, 186, 186, noun)).toBe('Showing 186 pages')
    expect(showingLabel(12, 12, 2014, noun)).toBe('Showing 12 pages · 2,014 in all, filtered')
    expect(showingLabel(1, 1, 1, noun)).toBe('Showing 1 page')
  })

  test('sort buttons state the order, and empty results say why', () => {
    expect(sortButtonLabel({ label: 'Score' }, [], 'score')).toBe(
      'Score, not sorted. Activate to sort; hold Shift to add a second sort.'
    )
    expect(
      sortButtonLabel(
        { label: 'Score' },
        [
          { key: 'folder', dir: 'asc' },
          { key: 'score', dir: 'desc' }
        ],
        'score'
      )
    ).toBe(
      'Score, sorted descending, sort 2 of 2. Activate to change; hold Shift to add a second sort.'
    )
    const state = toggleFacetValue({ ...BASE, search: 'zz' }, 'folder', 'blog')
    expect(emptyReason(state, COLUMNS, ['page', 'pages'])).toBe(
      'No pages match the search “zz” and the folder filter.'
    )
  })

  test('builds the CSV from the visible columns and a dated, safe file name', () => {
    const request = csvRequest(
      'x.csv',
      [COLUMNS[0], COLUMNS[2]] as GridColumn<Row>[],
      ROWS.slice(0, 2)
    )
    expect(request).toEqual({
      fileName: 'x.csv',
      header: ['Page', 'Score'],
      rows: [
        ['Text alerts', 50],
        ['Bulk SMS pricing', 31]
      ]
    })
    expect(csvFileName('TextBolt all pages', new Date(2026, 9, 20))).toBe(
      'TextBolt-all-pages-2026-10-20.csv'
    )
  })

  test('membership columns render a dash when the data is absent and (None) when empty', () => {
    const column = membershipColumn<Row>({
      id: 'cluster',
      label: 'Cluster',
      width: 150,
      get: (r) => r.clusters
    })
    const absent = ROWS[0] as Row
    const empty = { ...absent, clusters: [] }
    const member = { ...absent, clusters: [{ id: 'c1', name: 'Pricing & plans' }] }
    expect(column.csv(absent)).toBeNull()
    expect(column.filter?.kind === 'facet' && column.filter.values(absent)).toEqual([])
    expect(column.filter?.kind === 'facet' && column.filter.values(empty)).toEqual([''])
    expect(column.csv(member)).toBe('Pricing & plans')
    const group = membershipGroup<Row>({ id: 'cluster', label: 'Cluster', get: (r) => r.clusters })
    expect(group.key(absent)).toEqual({ key: '', label: '(None)' })
    expect(group.key(member)).toEqual({ key: 'c1', label: 'Pricing & plans' })
  })
})
