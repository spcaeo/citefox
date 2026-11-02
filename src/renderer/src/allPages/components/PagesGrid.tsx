import { useCallback, useId, useMemo, useRef, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { AllPageRow, AllPagesData } from '@shared/ipc'
import { AiSelection } from '../../assistant/context/AiSelection'
import { useAiContext } from '../../assistant/context/useAiContext'
import { askColumn } from '../../assistant/sparkle/askColumn'
import type { GridCsvExport, GridViewsAdapter } from '../../grid'
import { buildRowIndex, matchingIndices } from '../../grid/model/rows'
import { csvRequest } from '../../grid/model/csv'
import { csvFileName } from '../../grid/model/labels'
import { messageOf, useSavedViews } from '../../grid/hooks/useSavedViews'
import { addStartHash, pageHash } from '../../shell/routes'
import { Button, LinkButton, ListGrid, type ListFooterInfo } from '../../ui'
import type { AllPagesSource } from '../source'
import type { PageDrillKind } from '../utils/drills'
import { pageHref, viewHash } from '../utils/links'
import { rowMenuItems, type RowActions } from '../utils/rowMenu'
import { GRID_CARD_BORDERS } from '../../ui/listGrid/fit'
import { useElementWidth } from '../../ui/listGrid/useElementWidth'
import { useShowAllHeight } from '../hooks/useShowAllHeight'
import { fitHidden } from '../utils/fit'
import { linkedPresets } from '../utils/views'
import { rowName } from '../utils/text'
import {
  allPagesColumns,
  CLUSTER_GROUP,
  FOLDER_GROUP,
  searchText,
  STATUS_GROUP
} from '../utils/columns'
import { DEFAULT_HIDDEN, toListColumns, toListGroup } from '../utils/listColumns'
import {
  ALL_PAGES_GRID,
  PRESETS,
  presetState,
  savedState,
  SHORT_LABELS,
  toGridState,
  type PagesViewState
} from '../utils/presets'
import { BulkActions, type BulkDrawerActions, type BulkOutcome } from './BulkActions'
import { ColumnsPanel, FilterChips, FiltersPanel, SaveViewPanel } from './ListPanels'
import { ViewsMenu } from './ViewsMenu'

export { ALL_PAGES_GRID }

const SEARCH_LABEL = 'Search pages by title or URL'
/** Views `#/pages?preset=` opens again (saved views and deep-link views are not linkable). */
const LINKABLE = PRESETS.map((preset) => preset.id)

type Panel = 'filters' | 'columns' | 'save' | null

/**
 * The All pages list (FR-20.1, FR-21): every found page on the v2 list grid.
 * The segmented control picks a view (the old presets and `#/pages?…` deep
 * links); Filters adds column filters with counts; the Views menu groups,
 * picks columns and keeps saved views; row actions live behind ⋯.
 */
export function PagesGrid({
  data,
  source,
  views,
  exportCsv,
  exportName,
  params,
  onOpenPage,
  onDrill,
  rowActions,
  bulkDrawers,
  onBulkDone,
  onMessage,
  onLinkWritten
}: {
  data: AllPagesData
  /** `#/pages?…` deep-link values (see `linkedPresets`). */
  params?: Readonly<Record<string, string>> | undefined
  source: AllPagesSource
  views: GridViewsAdapter | null
  exportCsv: GridCsvExport | null
  exportName: string
  onOpenPage: (pageId: string) => void
  onDrill: (kind: PageDrillKind, row: AllPageRow) => void
  rowActions: RowActions
  bulkDrawers: BulkDrawerActions
  onBulkDone: (outcome: BulkOutcome) => void
  /** A plain message on the line above the grid (saved view, export). */
  onMessage: (message: string) => void
  /** The grid wrote its view into the URL itself (so the screen does not rebuild it). */
  onLinkWritten?: (hash: string) => void
}): JSX.Element {
  const markets = useMemo(
    () => new Map<string, Market>(data.markets.map((market) => [market.id, market])),
    [data.markets]
  )
  const hasClusters = data.rows.some((row) => (row.clusters?.length ?? 0) > 0)
  const hasGroups = (data.groups?.length ?? 0) > 0
  const columns = useMemo(
    () => allPagesColumns({ markets, hasClusters, hasGroups, now: new Date(), onDrill }),
    [markets, hasClusters, hasGroups, onDrill]
  )
  const presets = useMemo(
    () => linkedPresets(PRESETS, params, data.rows, markets),
    [params, data.rows, markets]
  )
  const [view, setView] = useState<PagesViewState>(() => presetState(presets[0]))
  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState(false)
  const saved = useSavedViews(views)
  const panelId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const showAllHeight = useShowAllHeight()

  const index = useMemo(() => buildRowIndex(data.rows, undefined), [data.rows])
  const rows = useMemo(
    () =>
      matchingIndices(index, { search: '', filters: view.filters, ranges: {} }, columns).map(
        (at) => index.rows[at] as AllPageRow
      ),
    [index, view.filters, columns]
  )
  const counts = useMemo(
    () =>
      new Map(
        presets.map((preset) => [
          preset.id,
          matchingIndices(
            index,
            { search: '', filters: preset.state.filters ?? {}, ranges: {} },
            columns
          ).length
        ])
      ),
    [presets, index, columns]
  )
  // The default columns fit the window (a narrow one drops Next check, then the link count).
  const stackWidth = useElementWidth(listRef)
  const hidden = useMemo(
    () =>
      fitHidden(columns, view.hidden, Math.max(0, stackWidth - GRID_CARD_BORDERS), [ASK_COLUMN]),
    [columns, view.hidden, stackWidth]
  )
  const listColumns = useMemo(
    () => [...toListColumns(columns, hidden), ASK_COLUMN],
    [columns, hidden]
  )
  const viewPreset = presets.find((preset) => preset.id === view.viewId)
  useAiContext({
    filters: {
      view: viewPreset ? (SHORT_LABELS[viewPreset.id] ?? viewPreset.label) : view.viewId,
      ...(view.groupBy ? { group: String(view.groupBy) } : {})
    }
  })
  const group = useMemo(() => {
    const option =
      view.groupBy === 'folder'
        ? FOLDER_GROUP
        : view.groupBy === 'cluster' && hasClusters
          ? CLUSTER_GROUP
          : view.groupBy === 'status'
            ? STATUS_GROUP
            : null
    if (!option) return undefined
    if (option !== FOLDER_GROUP) return toListGroup(option)
    // Folders in order, with the top level last (pages with no folder sort last, as before).
    const folders = [...new Set(data.rows.map((row) => row.folder ?? ''))]
      .filter((folder) => folder !== '')
      .sort((a, b) => a.localeCompare(b))
    return toListGroup({ ...option, order: [...folders, ''] })
  }, [view.groupBy, hasClusters, data.rows])

  const exportRows = useCallback(
    async (list: readonly AllPageRow[], what: string): Promise<string> => {
      if (!exportCsv) return 'Export is not available here.'
      setBusy(true)
      try {
        const shown = columns.filter((column) => column.fixed || !hidden.includes(column.id))
        const result = await exportCsv(csvRequest(csvFileName(exportName, new Date()), shown, list))
        if (!result.ok) return result.message
        return `Exported ${result.rowCount.toLocaleString('en-US')} ${result.rowCount === 1 ? 'row' : 'rows'} × ${result.columnCount} columns to ${result.fileName}: ${what}`
      } catch (cause) {
        return messageOf(cause, 'Could not export the CSV.')
      } finally {
        setBusy(false)
      }
    },
    [exportCsv, exportName, columns, hidden]
  )

  function pickView(id: string): void {
    const savedView = id.startsWith('saved:')
      ? saved.views.find((item) => `saved:${item.id}` === id)
      : undefined
    if (savedView) {
      setView((current) => savedState(savedView.id, savedView.state, current))
      return
    }
    const preset = presets.find((item) => item.id === id)
    if (!preset) return
    setView((current) => presetState(preset, current))
    // The picked view goes in the URL without reloading the grid (which would reset columns).
    const next = viewHash(window.location.hash, preset.id, LINKABLE)
    if (next !== null && next !== window.location.hash) {
      window.history.replaceState(window.history.state, '', next)
      onLinkWritten?.(next)
    }
  }

  function toggleFacet(columnId: string, value: string): void {
    setView((current) => {
      const on = current.filters[columnId] ?? []
      const next = on.includes(value) ? on.filter((item) => item !== value) : [...on, value]
      const filters = { ...current.filters }
      if (next.length === 0) delete filters[columnId]
      else filters[columnId] = next
      return { ...current, filters }
    })
  }

  const filterCount = Object.values(view.filters).reduce((sum, list) => sum + list.length, 0)
  const total = data.rows.length
  const savedId = view.viewId.startsWith('saved:') ? view.viewId.slice(6) : null
  const savedName = savedId ? saved.views.find((item) => item.id === savedId)?.name : undefined

  const summary = (info: ListFooterInfo): string => {
    const count = (n: number): string => n.toLocaleString('en-US')
    const shown =
      info.last - info.first + 1 < info.matching
        ? `Showing ${count(info.last - info.first + 1)} of ${count(info.matching)} pages`
        : `Showing ${count(info.matching)} ${info.matching === 1 ? 'page' : 'pages'}`
    return info.matching < total ? `${shown} · ${count(total)} in all, filtered` : shown
  }

  return (
    <div className="ap-list-stack" ref={listRef}>
      {saved.error ? (
        <p className="ap-error" role="alert">
          {saved.error}
        </p>
      ) : null}
      <FilterChips
        columns={columns}
        filters={view.filters}
        onRemove={toggleFacet}
        onClear={() => setView((current) => ({ ...current, filters: {} }))}
      />
      {panel === 'filters' ? (
        <FiltersPanel
          id={panelId}
          index={index}
          columns={columns}
          filters={view.filters}
          onToggle={toggleFacet}
          onClear={() => setView((current) => ({ ...current, filters: {} }))}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'columns' ? (
        <ColumnsPanel
          id={panelId}
          columns={columns}
          hidden={hidden}
          groupBy={view.groupBy}
          hasClusters={hasClusters}
          onGroup={(groupBy) => setView((current) => ({ ...current, groupBy }))}
          onToggle={(id) =>
            setView((current) => ({
              ...current,
              hidden: hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id]
            }))
          }
          onReset={() => setView((current) => ({ ...current, hidden: DEFAULT_HIDDEN }))}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'save' ? (
        <SaveViewPanel
          busy={saved.busy}
          onSave={async (name) => {
            const result = await saved.save(null, name, toGridState(view))
            if (result === null) return false
            setView((current) => ({ ...current, viewId: `saved:${result.id}` }))
            onMessage(`Saved as “${result.name}”: view, filters, sort, grouping and columns.`)
            return true
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}
      <ListGrid<AllPageRow>
        key={`${view.viewId}:${view.version}`}
        label="Pages"
        noun={['page', 'pages']}
        rows={rows}
        rowKey={rowKey}
        rowLabel={rowName}
        columns={listColumns}
        search={{ text: searchText, placeholder: SEARCH_LABEL }}
        filter={{
          label: 'View',
          options: presets.map((preset) => ({
            value: preset.id,
            label: SHORT_LABELS[preset.id] ?? preset.label,
            count: counts.get(preset.id) ?? 0
          })),
          value: view.viewId,
          onChange: pickView,
          resetValue: presets[0]?.id ?? 'all',
          // The screen's view switch, not a filter: it stays in the row (audit2 #7).
          stay: true
        }}
        actions={
          <>
            <ViewsMenu
              savedViews={saved.views}
              savedName={savedName ?? null}
              canSave={views !== null}
              filterCount={filterCount}
              onFilters={() => setPanel('filters')}
              onExport={
                exportCsv && !busy
                  ? () =>
                      void exportRows(
                        searched(rows, currentSearch(listRef.current)),
                        'the pages you see, with the current search, filters and columns.'
                      ).then(onMessage)
                  : null
              }
              onColumns={() => setPanel('columns')}
              onSave={() => setPanel('save')}
              onOpenSaved={(id) => pickView(`saved:${id}`)}
              onUpdateSaved={() => {
                if (savedId && savedName) void saved.save(savedId, savedName, toGridState(view))
              }}
              onDeleteSaved={() => {
                if (!savedId) return
                void saved.remove(savedId).then((ok) => {
                  if (ok) pickView(presets[0]?.id ?? 'all')
                })
              }}
            />
          </>
        }
        group={group}
        initialSort={view.sort}
        summary={summary}
        rowMenu={(row) => rowMenuItems(row, rowActions)}
        fitPage
        maxBodyHeight={showAllHeight}
        onActivate={(row) => openRow(row, onOpenPage)}
        empty={
          total === 0 ? (
            <div className="ap-empty">
              <p>No pages yet.</p>
              <LinkButton size="sm" href={addStartHash()} icon="plus">
                Set up your site
              </LinkButton>
            </div>
          ) : (
            <div className="ap-empty">
              <p>No pages match these filters.</p>
              <Button size="sm" onClick={() => setView((current) => ({ ...current, filters: {} }))}>
                Clear filters
              </Button>
            </div>
          )
        }
        bulk={(context) => (
          <>
            <AiSelection items={context.selected.map(pageRef)} />
            <BulkActions
              source={source}
              projectId={data.projectId}
              context={{
                ...context,
                exportSelected: () => exportRows(context.selected, 'the selected pages.')
              }}
              markets={data.markets}
              groups={data.groups}
              drawers={bulkDrawers}
              onDone={onBulkDone}
            />
          </>
        )}
      />
    </div>
  )
}

/** A page as Ask CiteFox names it. */
function pageRef(row: AllPageRow): { kind: 'page'; id: string; label: string; detail: string } {
  return { kind: 'page', id: row.id, label: rowName(row), detail: row.url }
}

const ASK_COLUMN = askColumn<AllPageRow>(pageRef)

function rowKey(row: AllPageRow): string {
  return row.id
}

/** Enter or a click on a row opens it where its title link goes. */
function openRow(row: AllPageRow, onOpenPage: (pageId: string) => void): void {
  const target = pageHref(row)
  if (target === null) return
  if (target.external) {
    window.open(target.href, '_blank', 'noopener,noreferrer')
    return
  }
  if (target.href === pageHash(row.id)) onOpenPage(row.id)
  else window.location.hash = target.href
}

/** The list's search text as typed (the v2 list grid keeps it), for Export CSV. */
function currentSearch(root: HTMLElement | null): string {
  return root?.querySelector<HTMLInputElement>('.ui-search-input')?.value.trim() ?? ''
}

/** Rows whose title or URL contains the search, as the list grid matches them. */
function searched(rows: readonly AllPageRow[], query: string): readonly AllPageRow[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return rows
  return rows.filter((row) => searchText(row).toLowerCase().includes(needle))
}
