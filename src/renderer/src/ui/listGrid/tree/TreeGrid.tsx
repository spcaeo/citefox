import {
  useCallback,
  useMemo,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import type { GridSortKey } from '@shared/domain'
import { clickedRow } from '../../../components/rowActivation'
import { LoadError } from '../../../components/LoadError'
import { sortByColumn } from '../../../grid/model/state'
import { DEFAULT_GRID_STATE } from '../../../grid/model/state'
import { Button } from '../../Button'
import { EmptyState } from '../../EmptyState'
import {
  applyLayout,
  columnsPicked,
  dropOrder,
  gridTemplate,
  hiddenColumnIds,
  isHideable,
  withoutEmptyColumns
} from '../columns'
import { ColumnsMenu } from '../ColumnsMenu'
import { FIT_LINES_UP_TO, fitColumns } from '../fit'
import { ListFooter } from '../ListFooter'
import { filtersActive } from '../filters'
import { ListHeader } from '../ListHeader'
import { ROW_HEIGHT } from '../ListLines'
import { LoadingRows } from '../LoadingRows'
import { hasPins, pinPlan } from '../pin'
import { ListBulkBar, ListToolbar } from '../ListToolbar'
import type { ListColumn, ListGridProps, ListTree } from '../types'
import { useColumnLayout } from '../useColumnLayout'
import { useNodeWidth } from '../useElementWidth'
import { useListUrl } from '../useListUrl'
import { useRowWindow } from '../useRowWindow'
import { useScrolledSideways } from '../useScrolledSideways'
import { useSelection } from '../useSelection'
import {
  allGroupIds,
  buildTree,
  DEFAULT_MORE_AFTER,
  DEFAULT_OPEN_ALL_UP_TO,
  treeColumnId,
  flattenTree,
  openTestFor,
  publicGroup,
  sortTree,
  toggleOpen,
  treeLineKey,
  type TreeLine,
  type TreeNode
} from './model'
import { TreeLines } from './TreeLines'
import { TreeTotal } from './TreeTotal'
import { useTreeState } from './useTreeState'

const HEADER_HEIGHT = 40
const DEFAULT_BODY = 640

function knownSort<Row>(
  sort: readonly GridSortKey[],
  columns: readonly ListColumn<Row>[]
): readonly GridSortKey[] {
  const ids = new Set(columns.map((column) => column.id))
  return sort.filter((key) => ids.has(key.key))
}

/**
 * ListGrid in tree mode (`tree` prop): the same toolbar, header, sorting,
 * resizing, Columns menu, URL state and loading rows, with the rows grouped
 * into a tree. Groups start closed (all open while searching); each open
 * group shows its first leaves, then "Show N more" (every leaf in a small tree).
 * Left and Right close and open a group (Left on a leaf moves to its group),
 * Enter opens a leaf or toggles a group. A total row under the lines adds up
 * every leaf that passes the search.
 */
export function TreeGrid<Row>(props: ListGridProps<Row> & { tree: ListTree<Row> }): JSX.Element {
  const { rows, rowKey, columns, noun, search, filter, bulk, rowMenu, onActivate, tree } = props
  const url = useListUrl(props.urlKey)
  const urlState = url.state
  const layout = useColumnLayout(props.saveKey ?? props.urlKey)
  const [resizing, setResizing] = useState(false)
  const [ownSearch, setOwnSearch] = useState('')
  const [ownSort, setOwnSort] = useState<readonly GridSortKey[]>(props.initialSort ?? [])
  const searchText = props.searchValue ?? (urlState ? (urlState.search ?? '') : ownSearch)
  const sort = useMemo(() => {
    if (props.sort) return props.sort
    if (urlState) {
      const known = knownSort(urlState.sort, columns)
      return known.length > 0 ? known : (props.initialSort ?? [])
    }
    return ownSort
  }, [props.sort, props.initialSort, urlState, columns, ownSort])

  const needle = searchText.trim().toLowerCase()
  const searchFn = search?.text
  const matchingRows = useMemo(
    () =>
      needle && searchFn
        ? rows.filter((row) => searchFn(row).toLowerCase().includes(needle))
        : rows,
    [rows, needle, searchFn]
  )

  const treeCol = treeColumnId(columns, tree)
  const { path, order } = tree
  const built = useMemo(() => {
    const next = buildTree(matchingRows, { path })
    sortTree(next.root, sort, columns, treeCol, order)
    return next
  }, [matchingRows, path, sort, columns, treeCol, order])

  const treeState = useTreeState(props.urlKey)
  const small = rows.length <= (tree.openAllUpTo ?? DEFAULT_OPEN_ALL_UP_TO)
  const searching = needle.length > 0
  const { defaultOpen } = tree
  const isOpen = useMemo(
    () => (searching ? () => true : openTestFor(treeState.open, built, defaultOpen)),
    [searching, treeState.open, built, defaultOpen]
  )
  const limit = small || searching ? null : (tree.moreAfter ?? DEFAULT_MORE_AFTER)
  const lines = useMemo<TreeLine<Row>[]>(
    () =>
      flattenTree(built.root, {
        rowKey,
        isOpen,
        showsAll: (id) => treeState.more.has(id),
        limit
      }),
    [built, rowKey, isOpen, treeState.more, limit]
  )

  const allKeys = useMemo(() => rows.map(rowKey), [rows, rowKey])
  const shownKeys = useMemo(
    () => lines.flatMap((line) => (line.kind === 'leaf' ? [line.key] : [])),
    [lines]
  )
  const { selection: selectionValue, onSelectionChange } = props
  const controlledSelection = useMemo(
    () =>
      selectionValue !== undefined && onSelectionChange !== undefined
        ? { value: selectionValue, onChange: onSelectionChange }
        : undefined,
    [selectionValue, onSelectionChange]
  )
  const selection = useSelection(allKeys, shownKeys, controlledSelection)
  const selectable = Boolean(bulk)

  // R6, as in the flat list: someone's widths and hidden columns, then what fits
  // the scroller's own width (0 until it mounts): `narrowDrops`, then low-priority columns.
  const { widths, hidden: hiddenIds, shown: shownIds } = layout
  // Someone's hidden columns, and the `defaultHidden` ones nobody showed.
  const hidden = useMemo(
    () => hiddenColumnIds(columns, { hidden: hiddenIds, shown: shownIds }),
    [columns, hiddenIds, shownIds]
  )
  const { narrowDrops } = props
  // `hideWhenEmpty` columns no row fills are left out before anything else.
  const filled = useMemo(() => withoutEmptyColumns(columns, rows), [columns, rows])
  const laidOut = useMemo(() => applyLayout(filled, { widths, hidden }), [filled, widths, hidden])
  const drops = useMemo(() => dropOrder(laidOut, narrowDrops), [laidOut, narrowDrops])
  // audit2 #6: an uncapped tree of up to FIT_LINES_UP_TO lines is drawn in full
  // and the page is its one scroll; a longer one keeps its window.
  const fitted =
    props.fitPage !== false &&
    props.maxBodyHeight === undefined &&
    props.height === undefined &&
    lines.length <= FIT_LINES_UP_TO
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const scrollWidth = useNodeWidth(drops.length > 0 || fitted ? scroller : null)
  const shown = useMemo(
    () =>
      drops.length > 0
        ? fitColumns(laidOut, drops, scrollWidth, { selectable, menu: Boolean(rowMenu) }).columns
        : laidOut,
    [laidOut, drops, scrollWidth, selectable, rowMenu]
  )
  const { template, minWidth } = gridTemplate(shown, selectable, Boolean(rowMenu))
  const colCount = shown.length + (selectable ? 1 : 0) + (rowMenu ? 1 : 0)
  const pageScroll = fitted && scrollWidth > 0 && minWidth <= scrollWidth
  // audit2 #6: the arrow column (and the tick boxes) stay put while the row scrolls sideways.
  const pins = useMemo(() => pinPlan(shown, selectable, treeCol), [shown, selectable, treeCol])
  const pinned = hasPins(pins)
  useScrolledSideways(scroller, pinned)
  const virtualize = props.virtualize !== false && !fitted
  const bodyHeight = fitted ? null : (props.maxBodyHeight ?? (virtualize ? DEFAULT_BODY : null))

  const lineKeys = useMemo(() => lines.map(treeLineKey), [lines])
  const leafOrdinal = useMemo(() => {
    let ordinal = 0
    return lines.map((line) => (line.kind === 'leaf' ? ordinal++ : -1))
  }, [lines])
  const rowWindow = useRowWindow({
    keys: lineKeys,
    estimate: ROW_HEIGHT,
    viewport: bodyHeight ?? DEFAULT_BODY,
    offset: HEADER_HEIGHT,
    virtualize
  })
  const { scrollRef, bodyRef, start, end, padTop, padBottom, onScroll, syncFocus } = rowWindow
  const attachScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      setScroller(node)
    },
    [scrollRef]
  )

  const every = useCallback(() => allGroupIds(built), [built])
  const allOpen = useMemo(() => every().every((id) => isOpen(id)), [every, isOpen])
  const setGroupOpen = useCallback(
    (node: TreeNode<Row>, open: boolean) => {
      if (searching) return
      treeState.setOpen(toggleOpen(treeState.open, node.id, open, isOpen, every))
    },
    [searching, treeState, isOpen, every]
  )
  const toggleGroup = useCallback(
    (node: TreeNode<Row>) => setGroupOpen(node, !isOpen(node.id)),
    [setGroupOpen, isOpen]
  )

  function setSearch(value: string): void {
    if (props.searchValue === undefined) {
      if (urlState) url.write({ search: value }, 'replace')
      else setOwnSearch(value)
    }
    props.onSearchChange?.(value)
  }

  function setSort(id: string, additive: boolean): void {
    const next = sortByColumn({ ...DEFAULT_GRID_STATE, sort }, id, additive).sort
    if (!props.sort) {
      if (urlState) url.write({ sort: next })
      else setOwnSort(next)
    }
    props.onSortChange?.(next)
  }

  const { setWidth, resetWidth, resetWidths, setHidden } = layout
  const widthOf = useCallback(
    (id: string) => {
      const own = columns.find((column) => column.id === id)?.width
      return widths[id] ?? (typeof own === 'number' ? own : 0)
    },
    [columns, widths]
  )
  const resize = useMemo(
    () => ({ widthOf, onResize: setWidth, onReset: resetWidth, onDragging: setResizing }),
    [widthOf, setWidth, resetWidth]
  )

  /** Keys on a line: Left/Right fold and unfold, Enter opens, Space selects. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (rowWindow.onKeyDown(event)) return
    const target = event.target as HTMLElement
    if (target.dataset.line === undefined) return
    const at = Number(target.dataset.line)
    const line = lines[at]
    if (!line) return
    if (line.kind === 'group') {
      const open = isOpen(line.node.id)
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const want = event.key === 'ArrowRight'
        if (want !== open) setGroupOpen(line.node, want)
        else if (want) rowWindow.setFocusIndex(Math.min(lines.length - 1, at + 1))
        else focusParent(at, line.node.depth)
      } else if (event.key === 'Enter' && open && tree.onActivateGroup) {
        event.preventDefault()
        tree.onActivateGroup(publicGroup(line.node))
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggleGroup(line.node)
      }
      return
    }
    if (line.kind === 'more') {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        treeState.showMore(line.node.id)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        focusParent(at, line.depth + 1)
      }
      return
    }
    if (event.key === 'Enter' && onActivate) {
      event.preventDefault()
      onActivate(line.row)
    } else if (event.key === ' ' && selectable) {
      event.preventDefault()
      selection.toggle(line.key)
    } else if (event.key === 'ArrowLeft' && line.depth > 0) {
      event.preventDefault()
      focusParent(at, line.depth)
    }
  }

  /** Moves focus up to the group a line at `depth` sits in. */
  function focusParent(at: number, depth: number): void {
    for (let up = at - 1; up >= 0; up -= 1) {
      const above = lines[up]
      if (above?.kind === 'group' && above.node.depth === depth - 1) {
        rowWindow.setFocusIndex(up)
        return
      }
    }
  }

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    const lineNode = clickedRow(event.target, 'data-line')
    if (!lineNode) return
    const line = lines[Number(lineNode.dataset.line)]
    if (line?.kind === 'group') toggleGroup(line.node)
    else if (line?.kind === 'leaf' && onActivate) onActivate(line.row)
  }

  const className = [
    'ui-lg',
    'ui-lg-tree',
    resizing ? 'ui-lg-resizing' : '',
    pageScroll ? 'ui-lg-page' : '',
    pinned ? 'ui-lg-pins' : '',
    props.className ?? ''
  ]
    .filter(Boolean)
    .join(' ')
  const style = props.height !== undefined ? { height: props.height } : undefined

  if (props.error) {
    return (
      <section className={className} style={style} aria-label={props.label}>
        <LoadError
          level={3}
          title={props.error.title ?? `Couldn't load the ${noun[1]}`}
          message={props.error.message ?? null}
          {...(props.error.onRetry ? { onRetry: props.error.onRetry } : {})}
        />
      </section>
    )
  }

  const header = (
    <ListHeader
      columns={shown}
      sort={sort}
      template={template}
      selectable={selectable}
      pageCheck={props.loading ? 'none' : selection.pageCheck}
      onTogglePage={props.loading ? () => undefined : selection.togglePage}
      menu={Boolean(rowMenu)}
      onSort={props.loading ? () => undefined : setSort}
      {...(props.loading ? {} : { resize, pins })}
    />
  )

  if (props.loading) {
    return (
      <section className={className} style={style} aria-label={props.label} aria-busy="true">
        <div className="ui-lg-scroll">
          <div className="ui-lg-inner" style={{ minWidth }}>
            {header}
            <LoadingRows columns={shown} template={template} label={noun[1]} />
          </div>
        </div>
      </section>
    )
  }

  const filterReset = filter
    ? (filter.resetValue ?? filter.options[0]?.value ?? filter.value)
    : null
  const engineOn = props.engine?.active === true
  const menuFilters = props.filters ?? []
  const controlFilters = props.filterControls ?? []
  const allFilters = [...menuFilters, ...controlFilters]
  const menuOn = filtersActive(allFilters) > 0
  const filtered = (filter !== undefined && filter.value !== filterReset) || engineOn || menuOn
  if (rows.length === 0 && !filtered) {
    return (
      <section className={className} style={style} aria-label={props.label}>
        {props.empty}
      </section>
    )
  }

  const matching = matchingRows.length
  const groupCount = built.groups.size
  const hideable = props.columnsMenu ? filled.filter(isHideable) : []
  const columnsMenu =
    hideable.length > 0 ? (
      <ColumnsMenu
        columns={hideable}
        shown={hideable.filter((column) => !hidden.includes(column.id)).map((column) => column.id)}
        onChange={(next) => {
          const picked = columnsPicked(hideable, next)
          setHidden(picked.hidden, picked.shown)
        }}
        onResetWidths={Object.keys(widths).length > 0 ? resetWidths : null}
      />
    ) : null
  const expandControls =
    tree.expandControls !== false && groupCount > 0 && !searching ? (
      // One toggle, so the toolbar keeps one row (audit2 #7): Collapse all while
      // every group is open, else Expand all.
      <span className="ui-lg-tree-expand">
        {allOpen ? (
          <Button variant="text" onClick={() => treeState.setOpen({ kind: 'none' })}>
            Collapse all
          </Button>
        ) : (
          <Button variant="text" onClick={() => treeState.setOpen({ kind: 'all' })}>
            Expand all
          </Button>
        )}
      </span>
    ) : null

  function clearSearch(): void {
    setSearch('')
    if (filter && filterReset !== null && filter.value !== filterReset) filter.onChange(filterReset)
    if (engineOn) props.engine?.onReset()
    if (menuOn) for (const group of allFilters) group.onChange(group.resetValue)
  }

  const count = (n: number): string => n.toLocaleString('en-US')
  // Just the count (owner 2026-10-30): the total row already adds the groups up.
  const footerLine = props.summary
    ? props.summary({ first: 1, last: matching, matching, total: rows.length, groups: groupCount })
    : `${count(matching)} ${matching === 1 ? noun[0] : noun[1]}`

  return (
    <section className={className} style={style} aria-label={props.label}>
      {bulk && selection.keys.size > 0 ? (
        <ListBulkBar
          selected={selection.keys.size}
          matching={matching}
          noun={noun}
          onSelectAll={
            selection.keys.size < matching ? () => selection.set(matchingRows.map(rowKey)) : null
          }
          onClear={selection.clear}
        >
          {bulk({
            selected: rows.filter((row) => selection.keys.has(rowKey(row))),
            clear: selection.clear
          })}
        </ListBulkBar>
      ) : (
        <ListToolbar
          searchLabel={
            search
              ? (search.placeholder ??
                `Search ${count(rows.length)} ${rows.length === 1 ? noun[0] : noun[1]}`)
              : null
          }
          searchValue={searchText}
          onSearch={setSearch}
          engine={props.engine?.control}
          filter={filter}
          filters={menuFilters}
          controls={controlFilters}
          toolbar={props.toolbar}
          actions={
            <>
              {expandControls}
              {props.actions}
            </>
          }
          columns={columnsMenu}
          ai={props.ai}
        />
      )}
      {matching === 0 ? (
        <EmptyState
          icon="search"
          title={
            needle
              ? `No ${noun[1]} match “${searchText.trim()}”`
              : `No ${noun[1]} match this filter`
          }
          action={
            <Button size="sm" onClick={clearSearch}>
              {needle ? 'Clear search' : 'Show all'}
            </Button>
          }
        />
      ) : (
        <div
          ref={attachScroller}
          className={`ui-lg-scroll${onActivate ? ' ui-lg-opens' : ''}`}
          role="treegrid"
          aria-label={props.label}
          aria-rowcount={lines.length + 1 + (tree.totalRow === false ? 0 : 1)}
          aria-colcount={colCount}
          aria-multiselectable={selectable || undefined}
          tabIndex={0}
          style={
            props.height === undefined && bodyHeight !== null
              ? { maxHeight: bodyHeight + HEADER_HEIGHT * 2 }
              : undefined
          }
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onClick={onClick}
          onFocus={(event) => {
            const line = (event.target as HTMLElement).dataset.line
            if (line !== undefined) syncFocus(Number(line))
          }}
        >
          <div className="ui-lg-inner" style={{ minWidth }}>
            {header}
            <div
              ref={bodyRef}
              role="rowgroup"
              style={{ paddingTop: padTop, paddingBottom: padBottom }}
            >
              <TreeLines
                lines={lines}
                start={start}
                end={end}
                columns={shown}
                template={template}
                treeColumn={treeCol}
                tree={tree}
                rowLabel={props.rowLabel}
                selectable={selectable}
                isSelected={selection.isSelected}
                onToggleRow={selection.toggle}
                onToggleGroup={toggleGroup}
                onShowMore={(node) => treeState.showMore(node.id)}
                rowMenu={rowMenu}
                isRowCurrent={props.isRowCurrent}
                rowProps={props.rowProps}
                colCount={colCount}
                noun={noun}
                leafOrdinal={leafOrdinal}
                pins={pins}
              />
            </div>
            {tree.totalRow === false ? null : (
              <TreeTotal
                label={tree.totalRow ?? 'Total'}
                rows={matchingRows}
                columns={shown}
                template={template}
                treeColumn={treeCol}
                selectable={selectable}
                menu={Boolean(rowMenu)}
                rowIndex={lines.length + 2}
                pins={pins}
              />
            )}
          </div>
        </div>
      )}
      {matching > 0 && props.footer !== 'paged' ? (
        <ListFooter
          line={footerLine}
          matching={matching}
          page={1}
          pages={1}
          showAll
          onShowAll={null}
          onShowFewer={null}
          onPage={() => undefined}
        />
      ) : null}
    </section>
  )
}
