import { useMemo, type JSX } from 'react'
import type { PageDetail } from '@shared/ipc'
import { answerRows, factualProblems, ownClaims, themeRows } from '@shared/sentiment-metrics'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost } from '../drill'
import { pageLabel } from '../projects/copy'
import { pageScopeRefs } from '../visibility/aiContext'
import { marketLabel } from '../shell/model'
import { EmptyState, SectionHead, SegmentedControl, TabPanel, Tabs } from '../ui'
import { formatMoment } from '../utils/dates'
import { useHashQuery } from '../utils/hashQuery'
import { AnswerTable } from './components/AnswerTable'
import { BrandFacts } from './components/BrandFacts'
import { BrandMatrixTable } from './components/BrandMatrixTable'
import { BrandPrompts } from './components/BrandPrompts'
import { FactualProblems } from './components/FactualProblems'
import { HowScored } from './components/HowScored'
import { KpiRow } from './components/KpiRow'
import { NegativeSources } from './components/NegativeSources'
import { ThemesTable } from './components/ThemesTable'
import { ToneSplit } from './components/ToneSplit'
import { TrendChart } from './components/TrendChart'
import { createSentimentDrills } from './drills'
import { useSentiment } from './hooks/useSentiment'
import { fixEvents, fixesFor } from '../fixes/chartEvents'
import { openChartEvent } from '../pageChanges/actions'
import { usePageChangeEvents } from '../pageChanges/hooks'
import { useChartFixes } from '../fixes/hooks/useChartFixes'
import { createSentimentSource, type SentimentSource } from './source'
import type { SentimentAssists, SourceFilter } from './types'
import { filterBySource, readingLine } from './utils/model'
import './sentiment.css'

const SOURCES: readonly { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Brand and buyer questions' },
  { value: 'brand', label: 'Brand questions' },
  { value: 'buyer', label: 'Buyer questions' }
]

/** The tab's sections (TOPICS-SPEC §1: big screens split with tabs). */
export type SentimentTab = 'overview' | 'answers' | 'themes' | 'problems' | 'facts'

const SENTIMENT_TABS: readonly SentimentTab[] = [
  'overview',
  'answers',
  'themes',
  'problems',
  'facts'
]

const PANEL_ID = 'st-panel'

/** `?view=` is the open section, `?from=` the "Overviews from" filter. Defaults have no key. */
const QUERY = ['view', 'from'] as const

function tabFrom(value: string | null): SentimentTab {
  return SENTIMENT_TABS.find((tab) => tab === value) ?? 'overview'
}

function filterFrom(value: string | null): SourceFilter {
  return SOURCES.find((item) => item.value === value)?.value ?? 'all'
}

/**
 * The page's Sentiment tab (SRS 4.16; Mockups/Sentiment.dc.html) in the v2
 * results pattern: a row of KPI tiles, then tabs (Overview, Answers, Themes,
 * Problems, Facts & prompts) with list grids. Every number opens the claims,
 * overviews or checks behind it in the shared drill drawer (REPORT-SPEC
 * "Interaction model", NFR-14).
 */
export function SentimentScreen({
  source,
  assists,
  projectId,
  page,
  marketId
}: {
  /** Tests only. Production uses the preload bridge. */
  source?: SentimentSource
  /** FR-16.9 AI-assist slots. Nothing renders without them. */
  assists?: SentimentAssists
  projectId: string
  page: PageDetail
  /** The page header's market picker (FR-9.8). Empty is the page's default market. */
  marketId: string
}): JSX.Element {
  const client = useMemo(() => source ?? createSentimentSource(), [source])
  const state = useSentiment(client, projectId, page.id, marketId || null)
  const fixList = useChartFixes(projectId)
  // A page screen: only the fixes logged on this page show as markers.
  const fixMarks = useMemo(
    () =>
      fixEvents(fixesFor(fixList, new Set([page.id])), {
        marketId: marketId || null,
        now: new Date()
      }),
    [fixList, page.id, marketId]
  )
  // Changes seen on this page that nobody logged: the dashed "?" markers.
  const thisPage = useMemo(() => new Set([page.id]), [page.id])
  const pageMarks = usePageChangeEvents(projectId, thisPage)
  const marks = useMemo(() => [...fixMarks, ...pageMarks], [fixMarks, pageMarks])
  // Every state has a URL: the section tab and the source filter live in the route's query.
  const [query, setQuery] = useHashQuery(QUERY)
  const tab = tabFrom(query.view)
  const filter = filterFrom(query.from)
  const setTab = (next: SentimentTab): void => setQuery({ view: next === 'overview' ? null : next })
  const setFilter = (next: SourceFilter): void => setQuery({ from: next === 'all' ? null : next })
  const view = state.view
  const market = page.markets.find((item) => item.id === (view?.marketId ?? marketId))
  const brand = view?.brand ?? null
  const latest = view?.trend.at(-1) ?? null
  const marketText = `${market ? marketLabel(market) : 'This market'}${
    latest ? ` · ${formatMoment(latest.checkedAt)}` : ''
  }`
  const filtered = view ? filterBySource(view, filter) : { overviews: [], claims: [] }
  useAiContext({
    entities: pageScopeRefs({
      pageId: page.id,
      page: pageLabel(page),
      market: market ?? null,
      runId: view?.latestRunId ?? null,
      checkedAt: latest?.checkedAt ?? null
    }),
    filters: {
      tab,
      ...(filter === 'all'
        ? {}
        : { from: SOURCES.find((item) => item.value === filter)?.label ?? filter })
    }
  })
  const status = view ? readingLine(view.reading) : null
  // The React Compiler memoizes this; the filter comes from the route query.
  const drills =
    view && brand !== null
      ? createSentimentDrills({
          view,
          brand,
          marketLabel: market ? marketLabel(market) : '',
          filter
        })
      : null

  const facts =
    view && brand !== null && drills !== null ? (
      <div className="st-stack">
        <BrandFacts
          facts={view.facts}
          checkedAt={latest?.checkedAt ?? null}
          canReread={view.latestRunId !== null}
          busyFacts={state.busy === 'fact'}
          busyReread={state.busy === 'reread' || view.reading.running}
          assist={assists?.suggestFacts?.(view)}
          onAdd={state.addFact}
          onDelete={state.deleteFact}
          onReread={state.reread}
        />
        <BrandPrompts
          brand={brand}
          set={view.brandPrompts}
          overviews={view.overviews}
          drills={drills}
          busyGenerate={state.busy === 'generate'}
          busySave={state.busy === 'save'}
          onGenerate={state.generateBrandPrompts}
          onSave={state.saveBrandPrompts}
        />
        <HowScored />
      </div>
    ) : null

  return (
    <DrillHost resetKey={`${page.id}\0${view?.marketId ?? marketId}`}>
      <div className="st-screen" data-testid="sentiment-tab">
        <div className="st-intro">
          <p className="st-lead">
            How Google&apos;s AI Overviews describe {brand ?? 'your brand'} and your competitors,
            claim by claim. CiteFox AI reads each overview and tags every claim&apos;s theme and
            tone.
          </p>
          {view && view.latestRunId !== null ? (
            <SegmentedControl
              label="Overviews from"
              size="sm"
              options={SOURCES}
              value={filter}
              onChange={setFilter}
            />
          ) : null}
        </div>
        {state.error ? (
          <p className="bridge-alert" role="alert">
            {state.error}
          </p>
        ) : null}
        {status ? (
          <p className="st-status" role="status">
            {status}
          </p>
        ) : null}
        {state.loading ? <p role="status">Loading sentiment…</p> : null}
        {view && brand === null ? (
          <EmptyState
            icon="warning"
            title="No brand name yet"
            body="This project has no brand name yet. Add it in Project settings so CiteFox AI knows which claims are about you."
          />
        ) : null}
        {view && brand !== null && drills !== null ? (
          <>
            {assists?.summary?.(view)}
            {view.latestRunId === null ? (
              <>
                <EmptyState
                  icon="inbox"
                  title="No check yet"
                  body={`No check yet. Press Check now to see what Google says about ${brand}.`}
                />
                {facts}
              </>
            ) : (
              <>
                {filtered.claims.length === 0 && view.reading.pending === 0 ? (
                  <p className="st-status">
                    CiteFox AI found no claims about {brand} or your competitors in these overviews.
                  </p>
                ) : null}
                <KpiRow
                  brand={brand}
                  competitors={view.competitors}
                  overviews={filtered.overviews}
                  claims={filtered.claims}
                  trend={view.trend}
                  drills={drills}
                />
                <Tabs
                  label="Sentiment sections"
                  size="sm"
                  panelId={PANEL_ID}
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { id: 'overview', label: 'Overview' },
                    {
                      id: 'answers',
                      label: 'Answers',
                      count: answerRows(filtered.overviews, filtered.claims, brand).length
                    },
                    {
                      id: 'themes',
                      label: 'Themes',
                      count: themeRows(ownClaims(filtered.claims)).length
                    },
                    {
                      id: 'problems',
                      label: 'Problems',
                      count: factualProblems(filtered.claims).length
                    },
                    { id: 'facts', label: 'Facts & questions', count: view.facts.length }
                  ]}
                />
                <TabPanel panelId={PANEL_ID} id={tab} className="st-panel">
                  {tab === 'overview' ? (
                    <div className="st-stack">
                      <ToneSplit
                        brand={brand}
                        competitors={view.competitors}
                        marketText={marketText}
                        overviews={filtered.overviews}
                        claims={filtered.claims}
                        drills={drills}
                      />
                      <TrendChart
                        brand={brand}
                        marketText={market ? marketLabel(market) : 'This market'}
                        trend={view.trend}
                        drills={drills}
                        events={marks}
                        trackingPages={thisPage}
                        onOpenEvent={openChartEvent}
                      />
                    </div>
                  ) : null}
                  {tab === 'answers' ? (
                    <section className="st-section" aria-labelledby="st-answers-h">
                      <SectionHead
                        id="st-answers-h"
                        title="Answer by answer"
                        description={`Each overview in this check that names ${brand}. Rank is ${brand}'s place among the brands that overview names.`}
                      />
                      <AnswerTable
                        brand={brand}
                        overviews={filtered.overviews}
                        claims={filtered.claims}
                        drills={drills}
                      />
                    </section>
                  ) : null}
                  {tab === 'themes' ? (
                    <div className="st-stack">
                      <section className="st-section" aria-labelledby="st-themes-h">
                        <SectionHead
                          id="st-themes-h"
                          title={`What the overviews say about ${brand}`}
                          description="Open a theme to read its exact sentences and sources."
                        />
                        <ThemesTable brand={brand} claims={filtered.claims} drills={drills} />
                      </section>
                      <BrandMatrixTable
                        brand={brand}
                        competitors={view.competitors}
                        claims={filtered.claims}
                        drills={drills}
                      />
                    </div>
                  ) : null}
                  {tab === 'problems' ? (
                    <div className="st-stack">
                      <FactualProblems
                        claims={filtered.claims}
                        overviews={view.overviews}
                        checkedAt={latest?.checkedAt ?? null}
                        hasFacts={view.facts.length > 0}
                        drills={drills}
                      />
                      <NegativeSources
                        brand={brand}
                        claims={filtered.claims}
                        assist={assists?.draftReplies?.(
                          view,
                          ownClaims(filtered.claims).filter((claim) => claim.tone === 'negative')
                        )}
                        drills={drills}
                      />
                    </div>
                  ) : null}
                  {tab === 'facts' ? facts : null}
                </TabPanel>
              </>
            )}
          </>
        ) : null}
      </div>
    </DrillHost>
  )
}
