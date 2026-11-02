import { useDeferredValue, useMemo } from 'react'
import type { GridViewState } from '@shared/domain'
import {
  buildRowIndex,
  matchingIndices,
  pageSlice,
  sortIndices,
  tableLines,
  treeLines,
  type PageSlice,
  type RowIndex,
  type TableLine,
  type TreeLine
} from '../model/rows'
import { visibleColumns } from '../model/state'
import type { DataGridProps, GridColumn, GridGroupOption } from '../types'

export interface GridModel<Row> {
  index: RowIndex<Row>
  /** Search as last applied. Lags typing by a frame under load (NFR-12). */
  appliedSearch: string
  matching: readonly number[]
  sorted: readonly number[]
  /** Rows in display order: by group when grouped, else sorted. */
  ordered: readonly number[]
  slice: PageSlice
  lines: readonly TableLine[]
  tree: readonly TreeLine[]
  /** Open tree nodes, including the default ones. */
  treeOpen: ReadonlySet<string>
  /** Rows on screen in the current view. */
  shownCount: number
  columns: readonly GridColumn<Row>[]
  groupOption: GridGroupOption<Row> | null
  treeOption: GridGroupOption<Row> | null
}

const EMPTY: ReadonlySet<string> = new Set()

/** Derives everything the grid draws. Each step is memoized on its inputs. */
export function useGridModel<Row>(
  props: Pick<
    DataGridProps<Row>,
    'rows' | 'columns' | 'search' | 'groupBy' | 'tree' | 'filteredFirst'
  >,
  state: GridViewState,
  page: number,
  collapsed: ReadonlySet<string>,
  treeOpen: ReadonlySet<string> | null
): GridModel<Row> {
  const { rows, columns, search, groupBy, tree, filteredFirst } = props
  const searchText = search?.text
  const index = useMemo(() => buildRowIndex(rows, searchText), [rows, searchText])
  const appliedSearch = useDeferredValue(state.search)
  const filterState = useMemo(
    () => ({ search: appliedSearch, filters: state.filters, ranges: state.ranges }),
    [appliedSearch, state.filters, state.ranges]
  )
  const matching = useMemo(
    () => matchingIndices(index, filterState, columns),
    [index, filterState, columns]
  )
  const narrowed =
    appliedSearch.trim().length > 0 ||
    Object.keys(state.filters).length > 0 ||
    Object.keys(state.ranges).length > 0
  const sorted = useMemo(() => {
    const list = sortIndices(index, matching, state.sort, columns)
    if (!filteredFirst || !narrowed) return list
    if (state.sort.some((key) => key.key === filteredFirst.unlessSortedBy)) return list
    const first: number[] = []
    const rest: number[] = []
    for (const at of list) {
      if (filteredFirst.test(index.rows[at] as Row)) first.push(at)
      else rest.push(at)
    }
    return first.concat(rest)
  }, [index, matching, state.sort, columns, filteredFirst, narrowed])
  const groupOption =
    state.view === 'table' ? (groupBy?.find((option) => option.id === state.groupBy) ?? null) : null
  const treeOption = tree?.find((option) => option.id === state.treeBy) ?? tree?.[0] ?? null
  const slice = useMemo(
    () => pageSlice(sorted.length, state.view === 'tree' ? 'all' : state.pageSize, page),
    [sorted.length, state.view, state.pageSize, page]
  )
  const table = useMemo(
    () => tableLines(index, sorted, groupOption, slice, collapsed),
    [index, sorted, groupOption, slice, collapsed]
  )
  const filtering = narrowed
  const treeList = useMemo(
    () =>
      state.view === 'tree' && treeOption
        ? treeLines(index, sorted, treeOption, treeOpen, filtering)
        : { lines: [], open: treeOpen ?? EMPTY },
    [state.view, treeOption, index, sorted, treeOpen, filtering]
  )
  const visible = useMemo(() => visibleColumns(state, columns), [state, columns])
  return {
    index,
    appliedSearch,
    matching,
    sorted,
    ordered: table.ordered,
    slice,
    lines: table.lines,
    tree: treeList.lines,
    treeOpen: treeList.open,
    shownCount: state.view === 'tree' ? sorted.length : slice.end - slice.start,
    columns: visible,
    groupOption,
    treeOption
  }
}
