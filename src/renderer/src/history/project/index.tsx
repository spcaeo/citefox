import { useCallback, useEffect, useMemo, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { HistorySubject, ProjectCheck } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { useAiContext } from '../../assistant/context/useAiContext'
import type { AssistClient } from '../../assist/client'
import type { AiEntityRef } from '../../assistant/context/types'
import { useBuildTools } from '../../buildMenu/buildClient'
import { enginesOf, hasEngine } from '../../engines/model'
import { useEngineFilter } from '../../engines/useEngineFilter'
import { LoadError } from '../../components/LoadError'
import { errorText } from '../../components/errorText'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { closeDrawer, openDrawer, setDrawerParams, useDrawerStack } from '../../shell/drawers'
import { marketLabel } from '../../shell/model'
import { navigateHash, replaceHash } from '../../shell/routes'
import { IconButton } from '../../ui'
import { patchHashQuery, useHashQuery } from '../../utils/hashQuery'
import { createProjectHistorySource, type ProjectHistorySource } from '../client'
import { ChecksGrid } from './components/ChecksGrid'
import { ColumnsMenu } from './components/ColumnsMenu'
import { CompareChecksDrawer } from './components/CompareChecksDrawer'
import { HistoryEmpty } from './components/HistoryEmpty'
import { useWhatChanged } from './hooks/useWhatChanged'
import { useCheckActions } from './hooks/useCheckActions'
import { useProjectHistory } from './hooks/useProjectHistory'
import { useRunResultsLoader } from './hooks/useRunResults'
import { useWideWindow } from './hooks/useWideWindow'
import { MonthSpend } from './spend/MonthSpend'
import { createMonthSpendSource, type MonthSpendSource } from './spend/source'
import {
  PROJECT_HISTORY_QUERY,
  checkHash,
  columnsParam,
  compareBlock,
  dropOrder,
  filterChecks,
  isCheckState,
  isCompareTab,
  isScopeFilter,
  olderFirst,
  parseColumns,
  parseCompare,
  parseSelection,
  parseSort,
  kindLabel,
  selectionParam,
  sortParam,
  type CompareTab,
  type ScopeFilter,
  type StatusFilter
} from './model'
import { historyCsv } from './utils/csv'
import { historyFilterControls } from './utils/filterControls'
import '../history.css'
import './project-history.css'

/**
 * Check history (project level, `#/history`): one row per check of every page and
 * topic, newest first, with its kind, score, change, what it found and the
 * searches it used. Each page's History tab still tells that page's whole story;
 * this screen is the ledger across the project, with the actions on a check
 * (re-run, retry, stop, delete, compare, CSV). Every filter, the sort, the search,
 * the ticked rows, the columns and an open comparison are in the route.
 */
export function ProjectHistoryScreen({
  projectId,
  source,
  spendSource,
  assistClient
}: {
  projectId: string
  source?: ProjectHistorySource
  /** Tests only. Null leaves the This month box out. */
  spendSource?: MonthSpendSource | null
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
}): JSX.Element {
  const client = useMemo(() => source ?? createProjectHistorySource(), [source])
  const spend = useMemo(
    () => (spendSource === undefined ? createMonthSpendSource() : spendSource),
    [spendSource]
  )
  const state = useProjectHistory(client, projectId)
  const [query, setQuery] = useHashQuery(PROJECT_HISTORY_QUERY)
  const { notify } = useBuildTools()
  const drawers = useDrawerStack()
  const wide = useWideWindow()
  const load = useRunResultsLoader(client, projectId)

  const data = state.data
  const checks = useMemo(() => data?.checks ?? [], [data])
  // The engine filter (`?engine=`): All plus each engine the checks asked, or one fixed logo.
  const offeredEngines = useMemo(() => enginesOf(checks.map((check) => check.engines)), [checks])
  const engineFilter = useEngineFilter(offeredEngines)
  const subjects = useMemo(
    () => new Map<string, HistorySubject>((data?.subjects ?? []).map((item) => [item.id, item])),
    [data]
  )
  const markets = useMemo(
    () => new Map<string, Market>((data?.markets ?? []).map((item) => [item.id, item])),
    [data]
  )
  const selection = useMemo(() => parseSelection(query.sel), [query.sel])
  const setSelection = useCallback(
    (ids: readonly string[]) => setQuery({ sel: selectionParam(ids) }, { replace: true }),
    [setQuery]
  )

  // Old "Compare content" links (`?compare=<a>,<b>`) open the Compare drawer on its content tab.
  const legacyCompare = query.compare
  useEffect(() => {
    if (legacyCompare === null) return
    const ids = parseCompare(legacyCompare)
    replaceHash(patchHashQuery(window.location.hash, { compare: null }))
    if (ids !== null) {
      openDrawer(
        'compare-checks',
        { 'cmp.a': ids[0], 'cmp.b': ids[1], 'cmp.tab': 'content' },
        { replace: true }
      )
    }
  }, [legacyCompare])

  const compareDepth = drawers.stack.findIndex((entry) => entry.id === 'compare-checks')
  const compareEntry = compareDepth >= 0 ? drawers.stack[compareDepth] : undefined
  const compared = useMemo(() => {
    if (compareEntry === undefined) return null
    const a = checks.find((check) => check.runId === compareEntry.params['cmp.a'])
    const b = checks.find((check) => check.runId === compareEntry.params['cmp.b'])
    if (a === undefined || b === undefined) {
      return { pair: null, problem: 'Those checks are not in this project any more.' }
    }
    return { pair: olderFirst(a, b), problem: compareBlock([a, b]) }
  }, [checks, compareEntry])
  const compareTab: CompareTab = isCompareTab(compareEntry?.params['cmp.tab'])
    ? (compareEntry?.params['cmp.tab'] as CompareTab)
    : 'results'

  const openCompare = useCallback((left: ProjectCheck, right: ProjectCheck) => {
    const [older, newer] = olderFirst(left, right)
    openDrawer('compare-checks', { 'cmp.a': older.runId, 'cmp.b': newer.runId })
  }, [])

  // "What changed" reads the same page or topic, market and scope as the grid.
  const scopeParam = isScopeFilter(query.scope) ? query.scope : null
  const whatChanged = useWhatChanged({
    projectId,
    pageId: query.page !== null && subjects.has(query.page) ? query.page : null,
    marketId: query.market !== null && markets.has(query.market) ? query.market : null,
    scope: query.page !== null && subjects.has(query.page) ? null : scopeParam,
    ...(assistClient ? { client: assistClient } : {})
  })

  const actions = useCheckActions({
    source: client,
    projectId,
    checks,
    subjects,
    markets,
    onCompare: openCompare,
    onChanged: state.reload,
    onDeleted: (ids) => setSelection(selection.filter((id) => !ids.includes(id)))
  })

  // What Ask CiteFox knows here: the picked page or topic and market, and the totals.
  const picked = query.page === null ? undefined : subjects.get(query.page)
  const pickedMarket = query.market === null ? undefined : markets.get(query.market)
  const named: AiEntityRef[] = []
  if (picked)
    named.push({
      kind: picked.kind === 'topic' ? 'topic' : 'page',
      id: picked.id,
      label: picked.label
    })
  if (pickedMarket)
    named.push({ kind: 'market', id: pickedMarket.id, label: marketLabel(pickedMarket) })
  useAiContext({
    entities: named,
    numbers: data
      ? [
          { label: 'Checks', value: String(data.checks.length) },
          {
            label: 'Searches used',
            value: String(data.checks.reduce((sum, check) => sum + check.searchesUsed, 0))
          }
        ]
      : []
  })

  if (state.error && data === null) {
    return (
      <div className="hp-screen">
        <LoadError
          title="Could not load the check history."
          message={state.error}
          onRetry={state.reload}
        />
      </div>
    )
  }
  if (data === null) {
    return (
      <div className="hp-screen">
        <p role="status" className="muted">
          Loading check history…
        </p>
      </div>
    )
  }
  if (data.checks.length === 0) {
    return (
      <div className="hp-screen" data-testid="history-empty">
        <HistoryEmpty tracked={data.trackedCount} />
      </div>
    )
  }

  const subjectId = query.page !== null && subjects.has(query.page) ? query.page : null
  const scope: ScopeFilter = subjectId === null && isScopeFilter(query.scope) ? query.scope : 'all'
  const market = query.market !== null && markets.has(query.market) ? query.market : null
  const status: StatusFilter = isCheckState(query.status) ? query.status : 'all'
  const filters = { scope, subjectId, marketId: market }
  const scoped = filterChecks(data.checks, subjects, { ...filters, status: 'all' }).filter(
    (check) => hasEngine(check.engines, engineFilter.engine)
  )
  const rows = status === 'all' ? scoped : filterChecks(scoped, subjects, { ...filters, status })
  const usedMarkets = new Set(data.checks.map((check) => check.marketId))
  const pages = data.subjects.filter((item) => item.kind === 'page')
  const topics = data.subjects.filter((item) => item.kind === 'topic')
  const searches = data.checks.reduce((sum, check) => sum + check.searchesUsed, 0)
  const columns = parseColumns(query.cols, wide)
  const search = query.q ?? ''

  function exportCsv(chosen: readonly ProjectCheck[]): void {
    void Promise.resolve()
      .then(() => client['grid:exportCsv'](historyCsv(chosen, subjects, markets)))
      .then(
        (result) => {
          if (result.ok) {
            notify(`Saved ${pluralize(result.rowCount, 'check')} to ${result.fileName}.`, 'ok')
          } else if (result.reason === 'failed') notify(result.message, 'bad')
        },
        (cause: unknown) => notify(errorText(cause, 'Could not save the CSV.'), 'bad')
      )
  }

  const filterControls = historyFilterControls({
    subjects: data.subjects,
    markets: data.markets,
    usedMarkets,
    subjectId,
    scope,
    market,
    label: marketLabel,
    onScope: (patch) => setQuery(patch),
    onMarket: (id) => setQuery({ market: id })
  })

  return (
    <div className="hp-screen">
      <div className="hp-lead-row">
        <p className="muted hp-lead">
          {pluralize(data.checks.length, 'check')} across {subjectCount(pages, topics)},{' '}
          {pluralize(searches, 'search', 'searches')} used.
        </p>
        {whatChanged.menu}
      </div>
      {whatChanged.card}
      <ChecksGrid
        rows={rows}
        all={scoped}
        subjects={subjects}
        markets={markets}
        status={status}
        sort={parseSort(query.sort)}
        search={search}
        columns={columns}
        drops={dropOrder(columns, wide)}
        filterControls={filterControls}
        engine={engineFilter.slot}
        actions={
          <>
            <IconButton
              icon="download"
              size="sm"
              tip
              label="Export CSV"
              onClick={() => exportCsv(searched(rows, subjects, markets, search))}
            />
            <ColumnsMenu
              shown={columns}
              onChange={(next) => setQuery({ cols: columnsParam(next, wide) }, { replace: true })}
            />
          </>
        }
        selection={selection}
        compareIds={compared?.pair?.map((check) => check.runId) ?? []}
        load={load}
        rowMenu={actions.menu}
        onSelection={setSelection}
        onStatus={(value) => setQuery({ status: value === 'all' ? null : value })}
        onSort={(sort) => setQuery({ sort: sortParam(sort) })}
        onSearch={(text) => setQuery({ q: text.trim() === '' ? null : text }, { replace: true })}
        onOpen={(check) => navigateHash(checkHash(check, subjects.get(check.pageId)))}
        onCompare={openCompare}
        onDelete={actions.askDelete}
        onExport={exportCsv}
      />
      {spend ? <MonthSpend source={spend} projectId={projectId} /> : null}
      {compareEntry === undefined || compared === null ? null : (
        <DrawerLevel depth={compareDepth}>
          <CompareChecksDrawer
            source={client}
            projectId={projectId}
            pair={compared.pair}
            problem={compared.problem}
            subjects={subjects}
            markets={markets}
            domain={ownDomain(data.subjects)}
            tab={compareTab}
            load={load}
            onTab={(tab) =>
              setDrawerParams(
                compareDepth,
                { 'cmp.tab': tab === 'results' ? null : tab },
                { push: true }
              )
            }
            onClose={() => closeDrawer(compareDepth)}
          />
        </DrawerLevel>
      )}
      {actions.confirm}
    </div>
  )
}

/** The rows the grid's search keeps, for the CSV of what is on screen. */
function searched(
  rows: readonly ProjectCheck[],
  subjects: ReadonlyMap<string, HistorySubject>,
  markets: ReadonlyMap<string, Market>,
  text: string
): ProjectCheck[] {
  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...rows]
  return rows.filter((check) => {
    const subject = subjects.get(check.pageId)
    const market = markets.get(check.marketId)
    const haystack =
      `${subject?.label ?? ''} ${subject?.url ?? ''} ${market ? marketLabel(market) : 'Removed market'} ${kindLabel(check.kind)}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

/** The project's own site, read from a tracked page's address. */
function ownDomain(subjects: readonly HistorySubject[]): string | null {
  const url = subjects.find((item) => item.url !== null)?.url
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function subjectCount(pages: readonly HistorySubject[], topics: readonly HistorySubject[]): string {
  if (topics.length === 0) return pluralize(pages.length, 'page')
  if (pages.length === 0) return pluralize(topics.length, 'topic')
  return `${pluralize(pages.length, 'page')} and ${pluralize(topics.length, 'topic')}`
}
