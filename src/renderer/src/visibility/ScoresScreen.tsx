import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { LoggedFix, Market, PageResults } from '@shared/domain'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost, useDrill } from '../drill'
import { formatMoment, type DrillSpec } from '../m3/model'
import { LoadError } from '../components/LoadError'
import { errorText } from '../components/errorText'
import type { AssistClient } from '../assist/client'
import { newFixValues } from '../fixes/drawer/model'
import { fixEvents } from '../fixes/chartEvents'
import { openChartEvent } from '../pageChanges/actions'
import { usePageChangeEvents } from '../pageChanges/hooks'
import { openDrawer } from '../shell/drawers'
import { useEngineRevision } from '../shell/engineRevision'
import { runningHash } from '../shell/routes'
import { marketLabel } from '../shell/model'
import type { ProgressAssists } from '../progress/assists'
import { createFixesSource, offlineFixesSource, type FixesSource } from '../progress/client'
import { FixesSection } from '../progress/FixesSection'
import { fixMarkers, promptMarks, readFixDraft, type FixDraft } from '../progress/model'
import { useFixes } from '../progress/useFixes'
import { WhatChanged } from '../progress/WhatChanged'
import { buildWhatChanged } from '../progress/changes'
import { DerivedPromptHistory, EmptyWhatChanged, LiveMarkets } from './ProgressSections'
import { useProgressAssistMenu } from './ProgressAssists'
import { ProgressKpis } from './ProgressKpis'
import { promptMeta } from './progressDrills'
import { ProgressRunsProvider } from './progressRuns'
import {
  focusFix,
  PROGRESS_FIX_EVENT,
  requestFix,
  runsDrill,
  useRunsValue
} from './progressRunsContext'
import { liveMarket, promptColumns, promptRows } from './promptHistory'
import { RateChart } from './RateChart'
import { PinToSummary } from '../overview/board/PinToSummary'
import { ScoresDetail } from './ScoresDetail'
import { loadScores, type Loaded } from './scoresLoad'
import { ScoresTable } from './ScoresTable'
import { createVisibilitySource, type VisibilitySource } from './source'
import { ChartKey } from './ChartKey'
import { pageScopeRefs } from './aiContext'
import {
  buildTrend,
  chartAccessibleName,
  citedPromptIds,
  firstCheckNote,
  markerEvents,
  rateTable,
  type LocalChartMarker
} from './trends'
import { SectionHead, SegmentedControl, TabPanel, Tabs, type ChartEvent, type TabItem } from '../ui'
import { useHashQuery } from '../utils/hashQuery'
import '../m3/m3.css'
import './visibility.css'
import './scores.css'

/** A stable default, so the load effect does not re-run on every render. */
const NO_MARKETS: readonly Market[] = []

interface ScoresScreenProps {
  source?: VisibilitySource
  /** Fixes channels. Defaults to the preload bridge. */
  fixesSource?: FixesSource
  /** FR-14.9 assist hook points. None by default. */
  assists?: ProgressAssists
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
  /** Clock for "planned" vs "live". Tests pass a fixed one. */
  now?: () => Date
  projectId: string
  pageId: string
  marketId: string | null
  market?: Market
  markets?: readonly Market[]
  /** A check pinned by the route (`?run=`): that point starts selected. Null is the latest. */
  runId?: string | null
  /** A route focus (`?filter=fix:<n>`): scrolls to that fix card and focuses it. */
  focus?: string | null
  /** Harness and tests only. Production AppShell does not pass this. */
  sample?: {
    markers: readonly LocalChartMarker[]
    rateFootnote: string
    renderBefore: (onDrill: (drill: DrillSpec) => void) => JSX.Element
    renderAfter: (onDrill: (drill: DrillSpec) => void) => JSX.Element
    renderMarkets: () => JSX.Element
  } | null
}

/**
 * Progress (FR-14). Every number opens the prompts behind it in the check it
 * belongs to, and every prompt opens Prompt detail in that market and check.
 */
export function ScoresScreen(props: ScoresScreenProps): JSX.Element {
  return (
    <DrillHost>
      <ScoresBody {...props} />
    </DrillHost>
  )
}

const NO_RUNS: ReadonlyMap<string, PageResults> = new Map()
const NO_FIXES: readonly LoggedFix[] = []
const PANELS = 'vis-progress-tab'

const PROGRESS_TABS = ['overview', 'fixes', 'prompts'] as const
type ProgressTab = (typeof PROGRESS_TABS)[number]
/** The screen's own state in the route: `?view=fixes|prompts` (Overview has none) and `?show=table`. */
const PROGRESS_QUERY = ['view', 'show'] as const
const VIEW_OPTIONS = [
  { value: 'chart', label: 'Chart' },
  { value: 'table', label: 'Table' }
] as const

function isProgressTab(value: string | null): value is ProgressTab {
  return value !== null && (PROGRESS_TABS as readonly string[]).includes(value)
}

function ScoresBody({
  source,
  projectId,
  pageId,
  marketId,
  market,
  markets = NO_MARKETS,
  runId = null,
  focus = null,
  sample = null,
  fixesSource,
  assists,
  assistClient,
  now = defaultNow
}: ScoresScreenProps): JSX.Element {
  const client = useMemo(() => source ?? createVisibilitySource(), [source])
  const fixesClient = useMemo(
    () => fixesSource ?? (hasBridge() ? createFixesSource() : offlineFixesSource()),
    [fixesSource]
  )
  const fixesState = useFixes(fixesClient, projectId, pageId)
  // Changes seen on this page that nobody logged: the dashed "?" markers.
  const thisPage = useMemo(() => new Set([pageId]), [pageId])
  const pageMarks = usePageChangeEvents(projectId, thisPage)
  const [draft] = useState<FixDraft | null>(() => takeFixDraft())
  const [payload, setPayload] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const marketKey = markets.map((item) => item.id).join('\0')
  const [reload, setReload] = useState(0)
  const requestKey = `${projectId}\0${pageId}\0${marketId ?? ''}\0${marketKey}\0${reload}`
  const revision = useEngineRevision()
  const [query, setQuery] = useHashQuery(PROGRESS_QUERY)
  const view: 'chart' | 'table' = query.show === 'table' ? 'table' : 'chart'
  const [selectedId, setSelectedId] = useState<string | null>(runId)
  const focusedFor = useRef<string | null>(null)
  const { open } = useDrill()
  // A fix draft or a fix focus opens on Fixes when the route names no tab.
  const [opensOnFixes] = useState(() => draft !== null || fixFocus(focus) !== null)
  const tab: ProgressTab = isProgressTab(query.view)
    ? query.view
    : opensOnFixes
      ? 'fixes'
      : 'overview'
  const setTab = useCallback(
    (next: ProgressTab, options?: { replace?: boolean }) =>
      setQuery({ view: next === 'overview' ? null : next }, options),
    [setQuery]
  )
  const setView = (next: 'chart' | 'table'): void =>
    setQuery({ show: next === 'table' ? 'table' : null })
  const [shownFix, setShownFix] = useState<number | null>(() => fixFocus(focus))
  /** A fix card to focus once the Fixes tab has drawn it. */
  const pendingFix = useRef<number | null>(null)

  // "Fix N" anywhere on Progress opens the Fixes tab on that fix, then focuses its card.
  useEffect(() => {
    function show(event: Event): void {
      const number = (event as CustomEvent<number>).detail
      if (typeof number !== 'number') return
      pendingFix.current = number
      setTab('fixes')
      setShownFix(number)
    }
    window.addEventListener(PROGRESS_FIX_EVENT, show)
    return () => window.removeEventListener(PROGRESS_FIX_EVENT, show)
  }, [setTab])

  // Opened on Fixes by a draft or a focus: write it, so Overview has a URL of its own.
  // An old "Plan as Fix N" link (`plan=1`) then opens the fix drawer on its draft.
  const wroteOpening = useRef(false)
  useEffect(() => {
    if (wroteOpening.current) return
    wroteOpening.current = true
    if (opensOnFixes && query.view === null) setTab('fixes', { replace: true })
    if (draft !== null) {
      openDrawer(
        'fix',
        newFixValues({ pageId, promptIds: draft.promptIds, text: draft.description }),
        { replace: true }
      )
    }
  }, [opensOnFixes, query.view, setTab, draft, pageId])

  useEffect(() => {
    let cancelled = false
    void loadScores(client, projectId, pageId, marketId, markets).then(
      (next) => {
        if (cancelled) return
        setPayload(next)
        setError(null)
        setLoadedKey(requestKey)
      },
      (cause: unknown) => {
        if (cancelled) return
        setPayload(null)
        setError(errorText(cause, 'Could not load scores.'))
        setLoadedKey(requestKey)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, pageId, marketId, markets, requestKey, revision])

  const trend = useMemo(
    () => (payload ? buildTrend(payload.history, payload.runs) : null),
    [payload]
  )
  const place = market ? marketLabel(market) : 'This market'
  const ownMarket = payload?.history.marketId || marketId
  const meta = useMemo(() => promptMeta(payload?.runs.values() ?? []), [payload])
  const fetchRun = useCallback(
    (id: string | null, run: string) =>
      client['results:get']({ projectId, pageId, marketId: id, runId: run }),
    [client, projectId, pageId]
  )
  const runs = useRunsValue({
    pageId,
    marketId: ownMarket,
    markets,
    place,
    runs: payload?.runs ?? NO_RUNS,
    meta,
    fetchRun
  })
  const fixesLoaded = fixesState.list !== null
  const ready = loadedKey === requestKey && payload !== null
  const loggedFixes = fixesState.list?.fixes ?? NO_FIXES
  const newestFix = loggedFixes.reduce((top, fix) => Math.max(top, fix.number), 0)
  const latestRunForFix = payload
    ? [...payload.history.points].reverse().find((point) => !point.partial)
    : undefined
  const nextFixNumber = Math.max(
    (latestRunForFix ? payload?.runs.get(latestRunForFix.runId)?.scope.nextFixNumber : null) ?? 1,
    newestFix + 1
  )
  const askFix =
    shownFix !== null && loggedFixes.some((fix) => fix.number === shownFix)
      ? shownFix
      : newestFix > 0
        ? newestFix
        : null
  const ai = useProgressAssistMenu({
    projectId,
    pageId,
    marketId,
    nextFixNumber,
    fixNumber: askFix,
    ...(assistClient ? { client: assistClient } : {})
  })

  const chosenBar = trend
    ? (trend.bars.find((bar) => bar.runId === selectedId) ??
      [...trend.bars].reverse().find((bar) => bar.inTrendLine) ??
      null)
    : null
  const chosenRun = chosenBar ? payload?.runs.get(chosenBar.runId) : undefined
  useAiContext({
    entities: pageScopeRefs({
      pageId,
      page: chosenRun ? (chosenRun.scope.pageTitle ?? chosenRun.scope.pageUrl) : null,
      market: market ?? null,
      runId: chosenBar?.runId ?? null,
      checkedAt: chosenBar?.finishedAt ?? null
    }),
    filters: { tab, view }
  })

  // History links a fix as `?filter=fix:<n>`: once the fixes load, go to it once.
  useEffect(() => {
    const number = fixFocus(focus)
    if (number === null || !ready || !fixesLoaded || focusedFor.current === focus) return
    focusedFor.current = focus
    requestFix(number)
  }, [focus, ready, fixesLoaded])

  // After the Fixes tab shows the picked fix, focus its card.
  useEffect(() => {
    const number = pendingFix.current
    if (number === null || tab !== 'fixes' || !fixesLoaded) return
    if (focusFix(number)) pendingFix.current = null
  })

  if (!ready || !payload || !trend) {
    if (loadedKey === requestKey && error) {
      return (
        <LoadError
          title="Could not load scores."
          message={error}
          onRetry={() => setReload((n) => n + 1)}
        />
      )
    }
    return <p role="status">Loading scores…</p>
  }

  const today = now()
  const fixes = fixesState.list?.fixes ?? []
  const promptsTotal =
    [...trend.bars].reverse().find((bar) => !bar.partial)?.promptsTotal ??
    payload.history.points.at(-1)?.promptsTotal ??
    0
  const markers: readonly LocalChartMarker[] =
    sample?.markers ?? fixMarkers(fixes, ownMarket, promptsTotal, today)
  const events: readonly ChartEvent[] = sample
    ? markerEvents(sample.markers)
    : [...fixEvents(fixes, { marketId: ownMarket, now: today }), ...pageMarks]
  const pageScore = payload.pages.pages.find((page) => page.pageId === pageId) ?? null
  const selected =
    trend.bars.find((bar) => bar.runId === selectedId) ??
    [...trend.bars].reverse().find((bar) => bar.inTrendLine) ??
    trend.bars[trend.bars.length - 1] ??
    null
  const latest = [...trend.bars].reverse().find((bar) => bar.inTrendLine) ?? null
  const rows = rateTable(trend.bars, markers)
  const name = chartAccessibleName(trend.bars, markers, place)
  const historyColumns = promptColumns(payload.history)
  const historyRows = promptRows(historyColumns, payload.runs)
  const marketRows = payload.marketHistories.map((item) =>
    liveMarket(item.id, item.name, item.history)
  )
  const fullBars = trend.bars.filter((bar) => !bar.partial)
  const previousFull = fullBars.at(-2)
  const latestFull = fullBars.at(-1)
  const previousResults = previousFull ? payload.runs.get(previousFull.runId) : undefined
  const latestResults = latestFull ? payload.runs.get(latestFull.runId) : undefined
  const changed =
    previousResults && latestResults
      ? buildWhatChanged(
          previousResults,
          latestResults,
          place,
          fixes.map((fix) => ({ number: fix.number, goLiveAt: fix.goLiveAt }))
        )
      : null
  const changeNote =
    trend.bars.length === 0
      ? 'No check in this market yet.'
      : fullBars.length <= 1
        ? firstCheckNote(fullBars[0]?.promptSetVersion)
        : 'The last two full checks could not be compared.'
  const shownScore =
    selected && latest && selected.runId === latest.runId && pageScore?.score != null
      ? pageScore.score
      : selected?.score
  const latestFullRunId = latestFull?.runId ?? null
  // Sample sections (harness) still hand over a DrillSpec: its prompts in the latest full check.
  const sampleDrill = (spec: DrillSpec): void =>
    open(runsDrill(runs, spec, spec.promptIds, ownMarket, latestFullRunId))

  const rateSection = (
    <section
      className="vis-panel stack-tight"
      aria-labelledby="rate-h"
      data-nfr-chart="citation-rate"
    >
      <SectionHead
        id="rate-h"
        title="How often overviews cite this page"
        description={`${place} · page cited ÷ AI Overviews shown, per check · days spaced to scale · markers under the line are your fixes and Google updates`}
        actions={
          <>
            <SegmentedControl
              label="View"
              size="sm"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
            />
            <PinToSummary
              projectId={projectId}
              name="this page’s trend"
              spec={{
                kind: 'trend',
                size: 'm',
                config: { scope: { kind: 'page', id: pageId }, label: name }
              }}
            />
          </>
        }
      />
      {trend.bars.length === 0 ? (
        <p className="empty">No check in this market yet.</p>
      ) : view === 'chart' ? (
        <div className="vis-split">
          <div className="vis-plot stack-tight">
            <RateChart
              bars={trend.bars}
              events={events}
              trackingPages={thisPage}
              name={name}
              selectedId={selected?.runId ?? null}
              onSelect={(bar) => {
                setSelectedId(bar.runId)
                open(
                  runsDrill(
                    runs,
                    {
                      id: `point:${bar.runId}`,
                      title: 'Page cited',
                      description: `${bar.citedLine} on ${formatMoment(bar.finishedAt)}.`
                    },
                    citedPromptIds(bar),
                    ownMarket,
                    bar.runId
                  )
                )
              }}
              onOpenEvent={(event) => {
                if (event.fixId || event.kind === 'page') openChartEvent(event)
                else if (event.number !== undefined) requestFix(event.number)
              }}
            />
            <ChartKey total={latest?.promptsTotal ?? 0} />
          </div>
          {selected ? (
            <ScoresDetail
              bar={selected}
              results={payload.runs.get(selected.runId)}
              markers={markers}
              score={shownScore}
            />
          ) : null}
        </div>
      ) : (
        <ScoresTable
          rows={rows}
          bars={trend.bars}
          name={name}
          footnote={
            sample?.rateFootnote ??
            'Rate = page cited ÷ overviews shown. Citations = links to this site in the overview sources.'
          }
        />
      )}
    </section>
  )

  const tabs: readonly TabItem<ProgressTab>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'fixes', label: 'Fixes', count: fixes.length },
    { id: 'prompts', label: 'Questions', count: historyRows.length }
  ]

  return (
    <ProgressRunsProvider value={runs}>
      <div className="page-stack m3-screen vis-progress">
        {sample ? null : (
          <ProgressKpis
            latest={latest}
            previous={previousFull ?? null}
            score={latest ? (pageScore?.score ?? latest.score) : null}
            fixes={fixes}
            marketId={ownMarket}
            changed={changed}
          />
        )}
        <div className="vis-tabbar">
          <Tabs
            label="Progress sections"
            size="sm"
            tabs={tabs}
            value={tab}
            onChange={(next) => setTab(next)}
            panelId={PANELS}
          />
          {sample ? null : <div className="vis-tabbar-ai">{ai.menu}</div>}
        </div>
        {ai.card}
        <TabPanel panelId={PANELS} id={tab} className="vis-tabpanel">
          {tab === 'overview' ? (
            <>
              {sample ? (
                sample.renderBefore(sampleDrill)
              ) : changed ? (
                <WhatChanged model={changed} runId={latestFullRunId} />
              ) : (
                <EmptyWhatChanged note={changeNote} checkHref={runningHash(pageId)} />
              )}
              {rateSection}
              {sample ? sample.renderMarkets() : <LiveMarkets rows={marketRows} pageId={pageId} />}
            </>
          ) : null}
          {tab === 'fixes' ? (
            sample ? (
              sample.renderAfter(sampleDrill)
            ) : (
              <FixesSection
                source={fixesClient}
                state={fixesState}
                projectId={projectId}
                pageId={pageId}
                marketId={ownMarket}
                markets={markets.length > 0 ? markets : market ? [market] : []}
                now={today}
                assists={assists}
                selected={shownFix}
                onSelect={setShownFix}
              />
            )
          ) : null}
          {tab === 'prompts' ? (
            <DerivedPromptHistory
              columns={historyColumns}
              rows={historyRows}
              place={place}
              pageId={pageId}
              marketId={ownMarket}
              marks={sample ? undefined : promptMarks(fixes, today)}
            />
          ) : null}
        </TabPanel>
      </div>
    </ProgressRunsProvider>
  )
}

/** The fix number in a route focus `fix:<n>`, or null. */
function fixFocus(focus: string | null): number | null {
  const match = focus ? /^fix:(\d+)$/.exec(focus) : null
  return match ? Number(match[1]) : null
}

function defaultNow(): Date {
  return new Date()
}

function hasBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.citefox)
}

/**
 * An old "Plan as Fix N" link (`plan=1`, before the fix drawer). Read it once,
 * then drop the query so a reload or a later visit does not open it again;
 * the drawer it opens keeps the draft on its own URL.
 */
function takeFixDraft(): FixDraft | null {
  if (typeof window === 'undefined') return null
  const draft = readFixDraft(window.location.hash)
  if (draft !== null) {
    const [path] = window.location.hash.split('?')
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${path ?? ''}`
    )
  }
  return draft
}
