import { useCallback, useEffect, useId, useMemo, useState, type JSX, type MouseEvent } from 'react'
import type { GridPageSize, GridSortKey, GridViewState } from '@shared/domain'
import { LoadError } from '../../components/LoadError'
import { useGridModel } from '../../grid/hooks/useGridModel'
import { initialGridState, sortByColumn } from '../../grid/model/state'
import { Button } from '../Button'
import { EmptyState } from '../EmptyState'
import {
  applyLayout,
  columnsPicked,
  dropOrder,
  GROUP_OPTION_ID,
  gridTemplate,
  hiddenColumnIds,
  isHideable,
  lineKey,
  toGridColumns,
  toGroupOption,
  withoutEmptyColumns
} from './columns'
import { ColumnsMenu } from './ColumnsMenu'
import { checkGridColumns, gridDevChecksOn } from './devChecks'
import { fitColumns, fitsPage } from './fit'
import { onGridClick, onGridKeyDown } from './interaction'
import { ListFooter } from './ListFooter'
import { filtersActive } from './filters'
import { defaultSummary } from './summary'
import { ListHeader } from './ListHeader'
import { ListLines, ROW_HEIGHT, type LineDetail } from './ListLines'
import { LoadingRows } from './LoadingRows'
import { hasPins, pinPlan } from './pin'
import { ListBulkBar, ListToolbar } from './ListToolbar'
import { TreeGrid } from './tree/TreeGrid'
import type { ListColumn, ListFooterInfo, ListGridProps } from './types'
import { useColumnLayout } from './useColumnLayout'
import { useNodeWidth } from './useElementWidth'
import { useListUrl } from './useListUrl'
import { useRowWindow } from './useRowWindow'
import { useScrolledSideways } from './useScrolledSideways'
import { useSelection } from './useSelection'

const HEADER_HEIGHT = 40
const DEFAULT_BODY = 640

/** A row key as an id fragment: anything but letters, digits, `_` and `-` becomes `_<hex>`. */
function domSafe(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, (char) => `_${char.charCodeAt(0).toString(16)}`)
}

/** Sort keys from a URL that name a sortable column; others (an old link) are dropped. */
function knownSort<Row>(
  sort: readonly GridSortKey[],
  columns: readonly ListColumn<Row>[]
): readonly GridSortKey[] {
  const ids = new Set(columns.flatMap((column) => (column.sort === false ? [] : [column.id])))
  return sort.every((key) => ids.has(key.key)) ? sort : sort.filter((key) => ids.has(key.key))
}

/** Puts the full text of a cut-off cell in its tooltip (R14), unless the cell has its own. */
function revealCutText(event: MouseEvent<HTMLDivElement>): void {
  const cell = (event.target as HTMLElement).closest?.<HTMLElement>('.ui-lg-td')
  if (!cell || cell.querySelector('[title]')) return
  const box = (cell.firstElementChild as HTMLElement | null) ?? cell
  const cut = box.scrollWidth > box.clientWidth + 1 || cell.scrollWidth > cell.clientWidth + 1
  const text = cell.textContent?.trim() ?? ''
  if (cut && text) cell.title = text
  else cell.removeAttribute('title')
}

/**
 * The one v2 list grid (Docs/TOPICS-SPEC.md §1, Theme.dc.html "List grid").
 * Every list is this grid: toolbar (search, segmented filter, one AI menu), a
 * bulk bar that replaces the toolbar on selection, sortable headers, sticky
 * collapsible groups with counts, 44px rows (taller when a column wraps),
 * tabular numbers, expandable row detail, a right-hand `⋯` row menu, and a
 * footer with the count, Show all and paging. It runs on the shared grid row
 * model (src/renderer/src/grid), so search, multi-key sort (Shift-click adds a
 * key), grouping and paging behave the same everywhere; long lists render a
 * window of measured rows (`virtualize={false}` draws them all). Filtering by
 * the segmented control is the caller's: pass the filtered `rows` and a
 * controlled `filter`. With `tree` the rows show as a tree (tree/TreeGrid).
 */
export function ListGrid<Row>(props: ListGridProps<Row>): JSX.Element {
  return props.tree ? <TreeGrid {...props} tree={props.tree} /> : <FlatListGrid {...props} />
}

/** The flat list: groups, paging and expandable row detail. */
function FlatListGrid<Row>(props: ListGridProps<Row>): JSX.Element {
  const { rows, rowKey, columns, noun, group, search, filter, bulk, rowMenu, onActivate } = props
  const startSize = props.pageSize ?? 25
  const gridColumns = useMemo(() => toGridColumns(columns), [columns])
  const groupOptions = useMemo(() => toGroupOption(group), [group])
  const searchText = search?.text
  const modelSearch = useMemo(
    () => (searchText ? { label: '', placeholder: '', text: searchText } : undefined),
    [searchText]
  )
  const [state, setState] = useState<GridViewState>(() =>
    initialGridState(gridColumns, {
      sort: props.initialSort ?? [],
      groupBy: group ? GROUP_OPTION_ID : null,
      pageSize: startSize
    })
  )
  const [ownPage, setOwnPage] = useState(1)
  // R5: with a urlKey the URL holds the sort, search, page and Show all.
  const url = useListUrl(props.urlKey)
  const urlState = url.state
  const layout = useColumnLayout(props.saveKey ?? props.urlKey)
  const [resizing, setResizing] = useState(false)
  const page = urlState ? urlState.page : ownPage
  const pageSize: GridPageSize = urlState ? (urlState.all ? 'all' : startSize) : state.pageSize
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(group?.collapsed ?? [])
  )
  const { sort: sortProp, searchValue, onSortChange, onSearchChange } = props
  const { initialSort } = props
  const urlSort = useMemo(() => {
    if (!urlState) return null
    const known = knownSort(urlState.sort, columns)
    return known.length > 0 ? known : (initialSort ?? [])
  }, [urlState, columns, initialSort])
  const viewState = useMemo(
    () => ({
      ...state,
      pageSize,
      groupBy: group ? GROUP_OPTION_ID : null,
      ...(sortProp ? { sort: sortProp } : urlSort ? { sort: urlSort } : {}),
      ...(searchValue !== undefined
        ? { search: searchValue }
        : urlState
          ? { search: urlState.search ?? '' }
          : {})
    }),
    [state, pageSize, group, sortProp, urlSort, searchValue, urlState]
  )
  const model = useGridModel(
    {
      rows,
      columns: gridColumns,
      groupBy: groupOptions,
      ...(modelSearch ? { search: modelSearch } : {})
    },
    viewState,
    page,
    collapsed,
    null
  )
  const { lines, index, slice } = model

  const allKeys = useMemo(() => rows.map(rowKey), [rows, rowKey])
  const pageKeys = useMemo(
    () =>
      lines.flatMap((line) => (line.kind === 'row' ? [rowKey(index.rows[line.index] as Row)] : [])),
    [lines, index, rowKey]
  )
  const { selection: selectionValue, onSelectionChange } = props
  const controlledSelection = useMemo(
    () =>
      selectionValue !== undefined && onSelectionChange !== undefined
        ? { value: selectionValue, onChange: onSelectionChange }
        : undefined,
    [selectionValue, onSelectionChange]
  )
  const selection = useSelection(allKeys, pageKeys, controlledSelection)
  const selectable = Boolean(bulk)
  const { renderDetail, hasDetail, detailLabel, rowLabel, narrowDrops } = props
  // R6: someone's widths and hidden columns, then what fits the scroller's own
  // width (0 until it mounts): `narrowDrops`, then low-priority columns.
  const { widths, hidden: hiddenIds, shown: shownIds } = layout
  // Someone's hidden columns, and the `defaultHidden` ones nobody showed.
  const hidden = useMemo(
    () => hiddenColumnIds(columns, { hidden: hiddenIds, shown: shownIds }),
    [columns, hiddenIds, shownIds]
  )
  // `hideWhenEmpty` columns no row fills are left out before anything else.
  const filled = useMemo(() => withoutEmptyColumns(columns, rows), [columns, rows])
  const laidOut = useMemo(() => applyLayout(filled, { widths, hidden }), [filled, widths, hidden])
  const drops = useMemo(() => dropOrder(laidOut, narrowDrops), [laidOut, narrowDrops])
  // audit2 #6: a list the caller does not cap is the screen's content. Drawn in
  // full (a page of rows, or a short Show all), it has no scroll of its own.
  const fitted = fitsPage(props, pageSize !== 'all', lines.length)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const scrollWidth = useNodeWidth(drops.length > 0 || fitted ? scroller : null)
  const shown = useMemo(
    () =>
      drops.length > 0
        ? fitColumns(laidOut, drops, scrollWidth, {
            selectable,
            menu: Boolean(rowMenu),
            detail: Boolean(renderDetail)
          }).columns
        : laidOut,
    [laidOut, drops, scrollWidth, selectable, rowMenu, renderDetail]
  )
  const { template, minWidth } = gridTemplate(
    shown,
    selectable,
    Boolean(rowMenu),
    Boolean(renderDetail)
  )
  const colCount = shown.length + (selectable ? 1 : 0) + (renderDetail ? 1 : 0) + (rowMenu ? 1 : 0)
  // While the row fits, the page is the one scroll and the header sticks to it.
  const pageScroll = fitted && scrollWidth > 0 && minWidth <= scrollWidth
  // audit2 #6: the main text column (and the tick boxes) stay put while the row scrolls sideways.
  const pins = useMemo(() => pinPlan(shown, selectable), [shown, selectable])
  const pinned = hasPins(pins)
  useScrolledSideways(scroller, pinned)
  const virtualize = props.virtualize !== false && !fitted
  // Drawn in full, a list grows to fit unless the caller caps it.
  const bodyHeight = fitted ? null : (props.maxBodyHeight ?? (virtualize ? DEFAULT_BODY : null))

  const lineKeys = useMemo(
    () => lines.map((line) => lineKey(line, index, rowKey)),
    [lines, index, rowKey]
  )
  const rowOrdinal = useMemo(() => {
    let ordinal = 0
    return lines.map((line) => (line.kind === 'row' ? ordinal++ : -1))
  }, [lines])
  const {
    scrollRef,
    bodyRef,
    start,
    end,
    padTop,
    padBottom,
    onScroll,
    onKeyDown: moveFocus,
    syncFocus
  } = useRowWindow({
    keys: lineKeys,
    estimate: ROW_HEIGHT,
    viewport: bodyHeight ?? DEFAULT_BODY,
    offset: HEADER_HEIGHT,
    virtualize
  })
  const attachScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      setScroller(node)
    },
    [scrollRef]
  )

  const detailBase = useId()
  const [ownExpanded, setOwnExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // Controlled (such as one open row in the URL) when the caller passes `expanded`.
  const { expanded: expandedProp, onExpandedChange } = props
  const expanded = useMemo<ReadonlySet<string>>(
    () => (expandedProp === undefined ? ownExpanded : new Set(expandedProp)),
    [expandedProp, ownExpanded]
  )
  const setOpen = useCallback(
    (key: string, open: boolean) => {
      if (expanded.has(key) === open) return
      const next = new Set(expanded)
      if (open) next.add(key)
      else next.delete(key)
      if (expandedProp === undefined) setOwnExpanded(next)
      onExpandedChange?.([...next])
    },
    [expanded, expandedProp, onExpandedChange]
  )
  const detail = useMemo<LineDetail<Row> | null>(() => {
    if (!renderDetail) return null
    return {
      render: renderDetail,
      has: hasDetail ?? (() => true),
      label: detailLabel ?? ((row: Row) => `details for ${rowLabel(row)}`),
      isOpen: (key) => expanded.has(key),
      toggle: (key) => setOpen(key, !expanded.has(key)),
      id: (key) => `${detailBase}-${domSafe(key)}`
    }
  }, [renderDetail, hasDetail, detailLabel, rowLabel, expanded, setOpen, detailBase])

  const groupCount = useMemo(() => {
    if (!group) return 0
    return new Set(model.matching.map((at) => group.key(index.rows[at] as Row).key)).size
  }, [group, model.matching, index])

  function setPage(next: number): void {
    if (urlState) url.write({ page: next })
    else setOwnPage(next)
  }

  function setPageSize(next: GridPageSize): void {
    if (urlState) url.write({ all: next === 'all', page: 1 })
    else {
      setState((current) => ({ ...current, pageSize: next }))
      setOwnPage(1)
    }
  }

  function setSearch(value: string): void {
    if (searchValue === undefined && urlState) url.write({ search: value, page: 1 }, 'replace')
    else {
      if (searchValue === undefined) setState((current) => ({ ...current, search: value }))
      setPage(1)
    }
    onSearchChange?.(value)
  }

  function setSort(id: string, additive: boolean): void {
    const next = sortByColumn(viewState, id, additive).sort
    if (!sortProp && urlState) url.write({ sort: next, page: 1 })
    else {
      if (!sortProp) setState((current) => ({ ...current, sort: next }))
      setPage(1)
    }
    onSortChange?.(next)
  }

  const widthOf = useCallback(
    (id: string) => {
      const own = columns.find((column) => column.id === id)?.width
      return widths[id] ?? (typeof own === 'number' ? own : 0)
    },
    [columns, widths]
  )
  const { setWidth, resetWidth, resetWidths, setHidden } = layout
  const resize = useMemo(
    () => ({ widthOf, onResize: setWidth, onReset: resetWidth, onDragging: setResizing }),
    [widthOf, setWidth, resetWidth]
  )

  // Developer-only: number columns not marked numeric, value columns with no sort.
  const drawn = lines.length > 0
  useEffect(() => {
    if (scroller && drawn && gridDevChecksOn()) {
      checkGridColumns(scroller, props.label, shown, selectable ? 1 : 0)
    }
  }, [scroller, drawn, shown, selectable, props.label])

  function toggleGroup(key: string): void {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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

  function clearSearch(): void {
    setSearch('')
    if (filter && filterReset !== null && filter.value !== filterReset) filter.onChange(filterReset)
    if (engineOn) props.engine?.onReset()
    if (menuOn) for (const group of allFilters) group.onChange(group.resetValue)
  }

  const handlers = {
    lines,
    index,
    moveFocus,
    toggleGroup,
    toggleRow: selectable ? (row: Row) => selection.toggle(rowKey(row)) : null,
    onActivate,
    expand: detail
      ? (row: Row, open: boolean) => {
          if (detail.has(row)) setOpen(rowKey(row), open)
        }
      : null
  }

  const className = [
    'ui-lg',
    props.rowAlign === 'start' ? 'ui-lg-top' : '',
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

  if (props.loading) {
    return (
      <section className={className} style={style} aria-label={props.label} aria-busy="true">
        <div className="ui-lg-scroll">
          <div className="ui-lg-inner" style={{ minWidth }}>
            <ListHeader
              columns={shown}
              sort={viewState.sort}
              template={template}
              selectable={selectable}
              pageCheck="none"
              onTogglePage={() => undefined}
              menu={Boolean(rowMenu)}
              detail={Boolean(renderDetail)}
              onSort={() => undefined}
            />
            <LoadingRows columns={shown} template={template} label={noun[1]} />
          </div>
        </div>
      </section>
    )
  }

  // No rows at all is the caller's empty state, unless their filter emptied the list.
  if (rows.length === 0 && !filtered) {
    return (
      <section className={className} style={style} aria-label={props.label}>
        {props.empty}
      </section>
    )
  }

  const matching = model.matching.length
  const paged = slice.pages > 1
  const info: ListFooterInfo = {
    first: matching === 0 ? 0 : slice.start + 1,
    last: slice.end,
    matching,
    total: rows.length,
    groups: groupCount
  }
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
  const hasTools = Boolean(
    search ||
    filter ||
    props.engine?.control ||
    allFilters.length > 0 ||
    props.toolbar ||
    props.actions ||
    props.ai ||
    columnsMenu
  )
  const query = model.appliedSearch.trim()

  return (
    <section className={className} style={style} aria-label={props.label}>
      {bulk && selection.keys.size > 0 ? (
        <ListBulkBar
          selected={selection.keys.size}
          matching={matching}
          noun={noun}
          onSelectAll={
            selection.keys.size < matching
              ? () => selection.set(model.matching.map((at) => rowKey(index.rows[at] as Row)))
              : null
          }
          onClear={selection.clear}
        >
          {bulk({
            selected: rows.filter((row) => selection.keys.has(rowKey(row))),
            clear: selection.clear
          })}
        </ListBulkBar>
      ) : hasTools ? (
        <ListToolbar
          searchLabel={
            search
              ? (search.placeholder ??
                `Search ${rows.length.toLocaleString('en-US')} ${rows.length === 1 ? noun[0] : noun[1]}`)
              : null
          }
          searchValue={viewState.search}
          onSearch={setSearch}
          engine={props.engine?.control}
          filter={filter}
          filters={menuFilters}
          controls={controlFilters}
          toolbar={props.toolbar}
          actions={props.actions}
          columns={columnsMenu}
          ai={props.ai}
          {...(filtered || viewState.search.trim() !== '' ? { onReset: clearSearch } : {})}
        />
      ) : null}
      {matching === 0 ? (
        <EmptyState
          icon="search"
          title={query ? `No ${noun[1]} match “${query}”` : `No ${noun[1]} match this filter`}
          action={
            <Button size="sm" onClick={clearSearch}>
              {query ? 'Clear search' : 'Show all'}
            </Button>
          }
        />
      ) : (
        <div
          ref={attachScroller}
          className={`ui-lg-scroll${onActivate ? ' ui-lg-opens' : ''}`}
          role="grid"
          aria-label={props.label}
          aria-rowcount={lines.length + 1}
          aria-colcount={colCount}
          aria-multiselectable={selectable || undefined}
          tabIndex={0}
          style={
            props.height === undefined && bodyHeight !== null
              ? { maxHeight: bodyHeight + HEADER_HEIGHT }
              : undefined
          }
          onScroll={onScroll}
          onMouseOver={revealCutText}
          onKeyDown={(event) => onGridKeyDown(event, handlers)}
          onClick={(event) => onGridClick(event, handlers)}
          onFocus={(event) => {
            const line = (event.target as HTMLElement).dataset.line
            if (line !== undefined) syncFocus(Number(line))
          }}
        >
          <div className="ui-lg-inner" style={{ minWidth }}>
            <ListHeader
              columns={shown}
              sort={viewState.sort}
              template={template}
              selectable={selectable}
              pageCheck={selection.pageCheck}
              onTogglePage={selection.togglePage}
              menu={Boolean(rowMenu)}
              detail={Boolean(renderDetail)}
              onSort={setSort}
              resize={resize}
              pins={pins}
            />
            <div
              ref={bodyRef}
              role="rowgroup"
              style={{ paddingTop: padTop, paddingBottom: padBottom }}
            >
              <ListLines
                index={index}
                lines={lines}
                start={start}
                end={end}
                columns={shown}
                template={template}
                rowKey={rowKey}
                rowLabel={props.rowLabel}
                group={group}
                selectable={selectable}
                isSelected={selection.isSelected}
                onToggleRow={selection.toggle}
                onToggleGroup={toggleGroup}
                rowMenu={rowMenu}
                isRowCurrent={props.isRowCurrent}
                rowProps={props.rowProps}
                rowOrdinal={rowOrdinal}
                detail={detail}
                colCount={colCount}
                pins={pins}
              />
            </div>
          </div>
        </div>
      )}
      {matching > 0 && (props.footer !== 'paged' || paged || pageSize !== startSize) ? (
        <ListFooter
          line={props.summary ? props.summary(info) : defaultSummary(info, noun, paged)}
          matching={matching}
          page={slice.page}
          pages={slice.pages}
          showAll={!paged}
          onShowAll={paged ? () => setPageSize('all') : null}
          onShowFewer={
            pageSize === 'all' && startSize !== 'all' && matching > startSize
              ? () => setPageSize(startSize)
              : null
          }
          onPage={setPage}
        />
      ) : null}
    </section>
  )
}
