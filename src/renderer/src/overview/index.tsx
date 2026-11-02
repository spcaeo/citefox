import { useMemo, type JSX } from 'react'
import type { VisibilityOverview } from '@shared/ipc'
import { questionsAndKeywords } from '@shared/pluralize'
import { useAiContext } from '../assistant/context/useAiContext'
import { LiveCheckLine } from '../components/LiveCheckLine'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import { useEngineRevision } from '../shell/engineRevision'
import { scopedCounts } from '../engines/model'
import { useEngineSummary } from '../engines/useEngineSummary'
import { usePageFixCount } from '../fixes/hooks/usePageFixCount'
import { useChartFixes } from '../fixes/hooks/useChartFixes'
import { fixEvents, fixesFor, subjectLabels } from '../fixes/chartEvents'
import { usePageChangeEvents } from '../pageChanges/hooks'
import { useProjectSearches } from '../fixes/hooks/useProjectSearches'
import { rollupPageFixes, type PageFix } from '@shared/page-fixes'
import { sectionHash } from '../shell/routes'
import { EmptyState, LinkButton } from '../ui'
import { BoardButtons } from './board/BoardButtons'
import { SummaryBoardView } from './board/SummaryBoardView'
import type { BoardStore } from './board/store'
import { createOverviewClient, type OverviewClient } from './client'
import { compareLabel, METHOD_PANEL, questionFilterFrom } from './compare'
import { MethodDrawer } from './components/MethodDrawer'
import { OverviewHeader } from './components/OverviewHeader'
import { marketLabel } from '../shell/model'
import { OverviewKpis } from './components/OverviewKpis'
import { FirstReportPanel } from './components/RailPanels'
import { ImpactLine } from './components/ImpactLine'
import { useOverview } from './hooks/useOverview'
import { useOverviewRoute } from './hooks/useOverviewRoute'
import { patchHashQuery } from '../utils/hashQuery'
import { leaveOverlayHash, pushOverlayHash } from '../utils/screenOverlay'
import { addQuestionsHash, screenState, searchesText, withSummaryGoogle } from './model'
import './board/board.css'
import './overview.css'

export type { OverviewClient } from './client'

/**
 * The AI visibility home: one quiet line to Reports → Impact review (where the verdict
 * lives) with the "Compare with" control, then the Summary as widgets the user arranges
 * (board/): today's cards and the gallery's, each with its own engine filter. The period,
 * market, compared check, questions filter, Edit mode, the gallery and the "How we
 * measure" drawer are in the URL.
 */
export function OverviewScreen({
  projectId,
  client,
  boardStore
}: {
  projectId: string
  /** Tests pass a fake. Default: the preload bridge. */
  client?: OverviewClient
  /** Where the widgets are kept. Tests pass their own; default: the project file. */
  boardStore?: BoardStore | null
}): JSX.Element {
  const source = useMemo(() => client ?? createOverviewClient(), [client])
  const route = useOverviewRoute()
  const { query, setQuery } = route
  const { state, reload } = useOverview(source, projectId, {
    period: route.period,
    marketId: query.market,
    vs: query.vs
  })
  const addHref = addQuestionsHash(route.hash)
  // How we measure is the screen's own `?panel=method`: opening is a history
  // entry, so Back closes it; closing steps back when this window opened it.
  const openMethod = (): void =>
    pushOverlayHash(patchHashQuery(window.location.hash, { panel: METHOD_PANEL }))
  const closeMethod = (): void =>
    leaveOverlayHash(patchHashQuery(window.location.hash, { panel: null }))
  const checkNow = (
    <LinkButton href={sectionHash('check')} variant="primary" icon="refresh">
      Check now
    </LinkButton>
  )
  const data = state.status === 'ready' ? state.data : null
  // The Fixes count, read again after each check (the same count as the sidebar badge).
  const pageFixes = usePageFixCount(projectId, useEngineRevision())
  const fixList = useChartFixes(projectId)
  const fixMarks = useMemo(
    () =>
      fixEvents(fixesFor(fixList, null), {
        now: new Date(),
        pageLabel: subjectLabels(fixList)
      }),
    [fixList]
  )
  // Changes seen on any page that nobody logged: the dashed "?" markers.
  const pageMarks = usePageChangeEvents(projectId, null)
  const marks = useMemo(() => [...fixMarks, ...pageMarks], [fixMarks, pageMarks])
  // Each engine's answers, for the widgets' own engine filters.
  const pageIds = useMemo(
    () => (data === null ? null : [...new Set(data.questions.map((item) => item.pageId))]),
    [data]
  )
  const engineSummary = useEngineSummary(
    data === null ? undefined : source['engines:summary'],
    projectId,
    { pageIds, marketId: query.market, reload: data }
  )
  const offered = useMemo(
    () => (engineSummary.engines.length >= 2 ? engineSummary.engines : []),
    [engineSummary.engines]
  )
  // Counted over the questions this Summary counts, each in its own market.
  // Google AI Overview counts by the headline's rule, so its tile matches "You're cited".
  const engineCounts = useMemo(
    () =>
      withSummaryGoogle(
        scopedCounts(data?.questions ?? [], engineSummary.questions, offered, engineSummary.counts),
        data?.questions ?? []
      ),
    [data, engineSummary, offered]
  )
  // Next fixes: the top page fixes of What to fix, from the searches it rolls up.
  const fixSearches = useProjectSearches(
    { 'fixes:searches': (request) => searchesOf(source, request) },
    projectId,
    source['fixes:searches'] !== undefined
  )
  const allFixes = useMemo<readonly PageFix[] | null>(
    () => (fixSearches.data === null ? null : rollupPageFixes(fixSearches.data.searches).fixes),
    [fixSearches.data]
  )
  const nextFixes = useMemo(() => allFixes?.slice(0, 3) ?? null, [allFixes])
  const compared = data === null ? null : compareLabel(data)
  useAiContext({
    entities:
      data === null || data.marketId === null
        ? []
        : [{ kind: 'market', id: data.marketId, label: shareMarket(data) }],
    filters: {
      period: route.period,
      ...(compared === null ? {} : { compare: `vs ${compared}` }),
      ...(compared === null ? {} : { change: questionFilterFrom(query.change, true) })
    }
  })
  const header = (
    <OverviewHeader
      period={route.period}
      onPeriod={route.setPeriod}
      markets={data?.markets ?? []}
      marketId={query.market}
      // Checks are per market: a compared check of the old market would not be found.
      onMarket={(marketId) => setQuery({ market: marketId, vs: null })}
      action={
        data === null || screenState(data) === 'no_questions' ? undefined : screenState(data) ===
          'ready' ? (
          <>
            <BoardButtons
              editing={query.edit === '1'}
              onEdit={() => setQuery({ edit: '1' })}
              onAdd={() => setQuery({ add: '1' })}
              onDone={() => setQuery({ edit: null, add: null })}
            />
            {query.edit === '1' ? null : checkNow}
          </>
        ) : (
          checkNow
        )
      }
    />
  )

  if (state.status === 'loading') {
    return (
      <div className="ov">
        {header}
        <p role="status">Loading the overview…</p>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="ov">
        {header}
        <LoadError title="Could not load the overview." message={state.message} onRetry={reload} />
      </div>
    )
  }

  const ready = state.data
  const phase = screenState(ready)
  return (
    <DrillHost>
      <div className="ov" aria-busy={state.refreshing || undefined}>
        {header}
        {phase === 'no_questions' ? null : (
          <LiveCheckLine live={ready.live} checkedAt={ready.lastCheckedAt} />
        )}
        {phase === 'no_questions' ? (
          <NoQuestions addHref={addHref} />
        ) : phase === 'no_checks' ? (
          <NoChecks data={ready} />
        ) : (
          <>
            <ImpactLine data={ready} onCompare={(vs) => setQuery({ vs })} onMethod={openMethod} />
            <SummaryBoardView
              store={boardStore}
              env={{
                projectId,
                data: ready,
                marketLabel: shareMarket(ready),
                offered: engineSummary.engines.length > 0 ? engineSummary.engines : ['google_aio'],
                source,
                query,
                setQuery,
                addHref,
                engineCounts,
                engineQuestions: engineSummary.questions,
                pageFixes,
                allFixes,
                nextFixes,
                marks
              }}
            />
            {ready.firstReport !== null ? (
              <div className="ov-first-report">
                <FirstReportPanel report={ready.firstReport} />
              </div>
            ) : null}
          </>
        )}
        {query.panel === METHOD_PANEL && phase !== 'no_questions' ? (
          <MethodDrawer data={ready} onClose={closeMethod} />
        ) : null}
      </div>
    </DrillHost>
  )
}

/** `fixes:searches` through the Overview's client (checked present by the caller). */
function searchesOf(
  source: OverviewClient,
  request: { projectId: string }
): ReturnType<NonNullable<OverviewClient['fixes:searches']>> {
  const read = source['fixes:searches']
  if (read === undefined) return Promise.reject(new Error('No fixes source'))
  return read(request)
}

function NoQuestions({ addHref }: { addHref: string }): JSX.Element {
  return (
    <div className="ov-empty">
      <EmptyState
        icon="search"
        level={2}
        title="No questions tracked yet"
        body="Add the questions your buyers ask Google. CiteFox checks who the AI Overview cites."
        action={
          <LinkButton href={addHref} variant="primary" icon="plus">
            Add questions
          </LinkButton>
        }
      />
    </div>
  )
}

/** The share's market scope: "all markets" unless one is picked. */
function shareMarket(data: VisibilityOverview): string {
  const market = data.markets.find((item) => item.id === data.marketId)
  return market === undefined ? 'all markets' : marketLabel(market)
}

function NoChecks({ data }: { data: VisibilityOverview }): JSX.Element {
  const questions = questionsAndKeywords(
    data.kpis.tracked.value - data.kpis.keywords,
    data.kpis.keywords
  )
  return (
    <>
      <OverviewKpis data={data} marketLabel={shareMarket(data)} />
      <div className="ov-empty">
        {data.live?.state === 'running' ? (
          <EmptyState
            icon="refresh"
            level={2}
            title="Checking your questions"
            body="The numbers fill in as the first answers come in."
          />
        ) : (
          <EmptyState
            icon="refresh"
            level={2}
            title="No checks yet"
            body={`Check now searches your ${questions}: ${searchesText(data.checkSearches)}.`}
          />
        )}
      </div>
    </>
  )
}
