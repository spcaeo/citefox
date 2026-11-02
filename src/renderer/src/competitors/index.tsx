import { useMemo, useState, type JSX } from 'react'
import type { CitedSiteRow } from '@shared/ipc'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { pinToSummary } from '../overview/board/pin'
import { DrillHost } from '../drill'
import { errorText } from '../components/errorText'
import { marketLabel } from '../shell/model'
import { notifyChanged } from '../shell/changes'
import { openDrawer } from '../shell/drawers'
import { Button, EmptyState, HelpFillPair, showUndo } from '../ui'
import { RemoveCompetitorConfirm } from '../sites/RemoveCompetitorConfirm'
import { siteLines } from '../sites/siteRows'
import type { SourceLine } from '../sites/sources'
import { useSourceActions, type SourceActions } from '../sites/useSourceActions'
import { useProjectSearches } from '../fixes/hooks/useProjectSearches'
import { useHashQuery } from '../utils/hashQuery'
import { siteRef } from './aiContext'
import { CompetitorGrid } from './components/CompetitorGrid'
import { CompetitorKpis } from './components/CompetitorKpis'
import { SectionFrame } from '../shell/SectionFrame'
import { COMPETITORS_SUBTITLE, CompetitorsScope } from './components/CompetitorsHeader'
import { GapDrawer } from './components/GapDrawer'
import { GAP_QUERY, gapView } from './gaps/rivalSearches'
import { SiteKindTable } from './components/SiteKindTable'
import { addCompetitorValues, editCompetitorValues, mergeCompetitorValues } from './drawer/model'
import { useAddCompetitor } from './hooks/useAddCompetitor'
import { useCompetitorsOverview } from './hooks/useCompetitorsOverview'
import { useGapActions } from './hooks/useGapActions'
import { useSiteKindSort } from './hooks/useSiteKindSort'
import {
  COMPETITORS_QUERY,
  DEFAULT_PERIOD,
  onlyNewFrom,
  kindFrom,
  kindRows,
  marketScope,
  periodFrom,
  sortFrom,
  sortParam
} from './model'
import { createCompetitorsSource, type CompetitorsSource } from './source'
import './competitors.css'

/**
 * Competitors (project level): who Google's AI Overviews cite and name across the
 * latest checks of every page and topic, against your own share, with the trend over
 * the period. Every state is in the route. Selecting a row opens "Where X is cited and
 * you're not"; the competitor drawer (window-wide) adds, edits and merges competitors.
 */
export function CompetitorsScreen(props: {
  projectId: string
  source?: CompetitorsSource
}): JSX.Element {
  // The numbers in the KPIs and the grid open drills.
  return (
    <DrillHost>
      <CompetitorsBody {...props} />
    </DrillHost>
  )
}

function CompetitorsBody({
  projectId,
  source
}: {
  projectId: string
  source?: CompetitorsSource
}): JSX.Element {
  const client = useMemo(() => source ?? createCompetitorsSource(), [source])
  const [query, setQuery] = useHashQuery(COMPETITORS_QUERY)
  const period = periodFrom(query.period)
  const scope = { period, marketId: query.market, productId: query.product }
  const state = useCompetitorsOverview(client, projectId, scope)
  const data = state.data
  const product = data?.products.find((item) => item.id === query.product) ?? null
  const adder = useAddCompetitor(client, projectId, product, state.reload)
  const onlyNew = onlyNewFrom(query.view)
  const kind = kindFrom(query.kind)
  const sort = useSiteKindSort(client, projectId, data?.unsortedDomains ?? 0, state.reload)
  const selected = data?.rows.find((row) => row.id === query.site) ?? null
  const market = data?.markets.find((item) => item.id === query.market)
  const selectedRef = selected === null ? null : siteRef(selected)
  useAiContext({
    entities: [
      ...(market ? [{ kind: 'market' as const, id: market.id, label: marketLabel(market) }] : []),
      ...(selectedRef ? [selectedRef] : [])
    ],
    filters: {
      period: `${period} days`,
      ...(product ? { product: product.name } : {}),
      ...(onlyNew ? { show: 'new' } : {}),
      ...(kind === null ? {} : { kind: String(kind) })
    }
  })
  const gapActions = useGapActions(client, projectId, selected?.id ?? null, state.reload)
  // Your result and win odds per search, read once a site's drawer opens.
  const searches = useProjectSearches(client, projectId, selected !== null)
  const [gapQuery, setGapQuery] = useHashQuery(GAP_QUERY)
  const typeActions = useSourceActions(client, projectId, null)
  const lines = useMemo(() => {
    const rows = data?.rows ?? []
    const list = siteLines(
      rows.map((row) => ({
        key: row.id,
        domain: row.domain,
        classification:
          row.kind === 'you' ? 'own' : row.kind === 'competitor' ? 'competitor' : 'other',
        competitorId: row.kind === 'competitor' ? row.id : null,
        competitorName: row.name
      })),
      [],
      typeActions.settings
    )
    return new Map<string, SourceLine>(list.map((line) => [line.key, line]))
  }, [data, typeActions.settings])
  const [removeError, setRemoveError] = useState<string | null>(null)
  const you = data?.rows.find((row) => row.kind === 'you') ?? null
  const drillScope = {
    marketLabel: data ? marketScope(data) : '',
    brand: you?.name ?? '',
    domain: data?.ownDomain ?? ''
  }

  /** The screen as it is, with one site's drawer open (a drill row goes there). */
  const siteHref = (id: string): string => {
    const params = new URLSearchParams()
    for (const key of COMPETITORS_QUERY) {
      const value = key === 'site' ? id : query[key]
      if (value !== null) params.set(key, value)
    }
    return `#/competitors?${params.toString()}`
  }

  /** Removes a saved competitor at once; the toast's Undo puts it back. */
  async function remove(row: CitedSiteRow): Promise<void> {
    setRemoveError(null)
    try {
      const result = await client['competitors:remove']({ projectId, ids: [row.id] })
      notifyChanged('competitors')
      showUndo({
        message: `Removed ${row.name} from competitors.`,
        effect: 'Past checks keep their results; its links count as other sites now.',
        undo: async () => {
          await client['competitors:restore']({ projectId, undoToken: result.undoToken })
          notifyChanged('competitors')
        }
      })
    } catch (cause) {
      setRemoveError(errorText(cause, 'Could not remove the competitor.'))
    }
  }

  const rowActions = {
    onEdit: (row: CitedSiteRow) => openDrawer('competitor', editCompetitorValues(row.id)),
    onMerge: (row: CitedSiteRow) => openDrawer('competitor', mergeCompetitorValues(row.id)),
    onRemove: (row: CitedSiteRow) => void remove(row)
  }

  /** Saved, the site becomes a competitor row with a new id, so its drawer closes. */
  function add(row: CitedSiteRow): void {
    void adder.add(row).then((saved) => {
      if (saved && query.site === row.id) setQuery({ site: null }, { replace: true })
    })
  }

  // "Mark as competitor" saves through the screen's adder, so a picked product applies.
  const siteActions: SourceActions = {
    ...typeActions,
    saving: adder.saving ?? typeActions.saving,
    markCompetitor: (line) => {
      const row = data?.rows.find((item) => item.id === line.key)
      if (row) add(row)
    }
  }

  function open(row: CitedSiteRow): void {
    if (row.kind === 'you') return
    setQuery({ site: row.id })
  }

  const scopeControls = (
    <CompetitorsScope
      period={period}
      productId={query.product}
      marketId={query.market}
      products={data?.products ?? []}
      markets={data?.markets ?? []}
      onPeriod={(value) =>
        setQuery({ period: Number(value) === DEFAULT_PERIOD ? null : value, site: null })
      }
      onProduct={(value) => setQuery({ product: value, site: null })}
      onMarket={(value) => setQuery({ market: value, site: null })}
    />
  )
  const addOne = (): void => openDrawer('competitor', addCompetitorValues())
  // ✦ Help me find them: the importer with the helper open; its rows are checked there.
  const findThem = (): void =>
    openDrawer(
      'import',
      { 'import.entity': 'competitors', 'import.help': '1' },
      { onResult: state.reload }
    )
  // The standard header: Add competitor is the one green button, Import under ⋯.
  const frame = (body: JSX.Element): JSX.Element => (
    <SectionFrame
      title="Competitors"
      subtitle={COMPETITORS_SUBTITLE}
      actions={scopeControls}
      primary={{ label: 'Add competitor', icon: 'plus', onClick: addOne, guide: 'competitors-add' }}
      more={[
        {
          id: 'find',
          label: 'Help me find competitors',
          icon: 'sparkle',
          onSelect: findThem
        },
        {
          id: 'import',
          label: 'Import competitors',
          icon: 'upload',
          onSelect: () =>
            openDrawer('import', { 'import.entity': 'competitors' }, { onResult: state.reload })
        }
      ]}
    >
      {body}
    </SectionFrame>
  )

  if (state.error) {
    const scoped = query.product !== null || query.market !== null
    return frame(
      <div className="cmp-screen">
        <LoadError
          title="Could not load who the AI Overviews cite."
          message={state.error}
          onRetry={state.reload}
        >
          {scoped ? (
            <Button onClick={() => setQuery({ product: null, market: null, site: null })}>
              Show every product and market
            </Button>
          ) : null}
        </LoadError>
      </div>
    )
  }

  if (data === null) {
    return frame(
      <div className="cmp-screen">
        <p role="status" className="muted">
          Loading competitors…
        </p>
      </div>
    )
  }

  // No saved competitor yet (whatever the scope): the panel 6 empty state, with its pair.
  const noCompetitors = !data.rows.some((row) => row.kind === 'competitor')
  const noneSaved = noCompetitors ? (
    <div className="cmp-empty" data-testid="cmp-no-competitors">
      <EmptyState
        icon="crosshair"
        compact={data.checks > 0}
        title="No competitors yet"
        body="Who else should Google cite for your questions?"
        action={
          <HelpFillPair
            primary={{ label: 'Add competitor', onClick: addOne }}
            help={{ label: 'Help me find them', onClick: findThem }}
          />
        }
      />
    </div>
  ) : null

  return frame(
    <div className="cmp-screen" aria-busy={state.loading || undefined}>
      {noneSaved}
      {data.checks === 0 ? (
        noneSaved === null ? (
          <EmptyState
            title="No checks in this view yet."
            body="Once a page or topic has a check, the sites its AI Overviews cite and name show here."
          />
        ) : null
      ) : (
        <>
          <CompetitorKpis
            data={data}
            drillScope={drillScope}
            onOpen={(id) => setQuery({ site: id })}
            siteHref={siteHref}
          />
          {adder.error || removeError || typeActions.error ? (
            <p className="bridge-alert" role="alert">
              {adder.error ?? removeError ?? typeActions.error}
            </p>
          ) : null}
          {adder.notice ? (
            <p className="muted" role="status">
              {adder.notice}
            </p>
          ) : null}
          {query.site !== null && selected === null && !state.loading ? (
            <p className="muted" role="status">
              That site is not in these results.
            </p>
          ) : null}
          <SiteKindTable
            rows={kindRows(data.rows)}
            sites={data.rows}
            drillScope={drillScope}
            siteHref={siteHref}
            periodStart={data.periodStart}
            period={data.period}
            kind={kind}
            sorting={sort.sorting}
            needsAi={sort.needsAi}
            onSortNow={sort.sortNow}
            unsorted={data.unsortedDomains}
            onKind={(value) => setQuery({ kind: value })}
          />
          <CompetitorGrid
            rows={data.rows}
            lines={lines}
            siteActions={siteActions}
            onlyNew={onlyNew}
            kind={kind}
            search={query.q ?? ''}
            sort={sortFrom(query.sort)}
            selectedId={selected?.id ?? null}
            saving={adder.saving}
            drillScope={drillScope}
            actions={rowActions}
            onNew={(value) => setQuery({ view: value ? 'new' : null })}
            onKind={(value) => setQuery({ kind: value })}
            // Typing rewrites the one entry; Back leaves the search, not each letter.
            onSearch={(value) => setQuery({ q: value === '' ? null : value }, { replace: true })}
            onSort={(value) => setQuery({ sort: sortParam(value) })}
            onOpen={open}
            onAdd={add}
            onPin={(row) =>
              row.domain
                ? void pinToSummary(
                    projectId,
                    { kind: 'competitor', config: { domain: row.domain, label: row.name } },
                    row.name
                  )
                : undefined
            }
          />
        </>
      )}
      {selected ? (
        <GapDrawer
          row={selected}
          markets={data.markets}
          products={data.products}
          searches={searches.data?.searches ?? []}
          view={gapView(gapQuery.gv)}
          onView={(next) => setGapQuery({ gv: next === 'win' ? null : next, 'gap.p': null })}
          productHref={(productId) => {
            const params = new URLSearchParams(siteHref(selected.id).split('?')[1] ?? '')
            if (productId === null) params.delete('product')
            else params.set('product', productId)
            return `#/competitors?${params.toString()}`
          }}
          saving={adder.saving === selected.id}
          actions={gapActions}
          addable={lines.get(selected.id)?.relation.kind !== 'platform'}
          onAdd={add}
          onEdit={rowActions.onEdit}
          onClose={() =>
            setQuery({
              site: null,
              ...Object.fromEntries(GAP_QUERY.map((key) => [key, null]))
            })
          }
        />
      ) : null}
      <RemoveCompetitorConfirm pending={typeActions.pendingRemoval} />
    </div>
  )
}
