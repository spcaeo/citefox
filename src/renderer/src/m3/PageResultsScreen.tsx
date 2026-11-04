import type { JSX, ReactNode } from 'react'
import type { PageResults } from '@shared/domain'
import { useAiContext } from '../assistant/context/useAiContext'
import { PageHeader } from '../components/Header'
import { PageTabs } from '../components/PageTabs'
import { SponsorSlot } from '../components/SponsorSlot'
import { DrillHost } from '../drill'
import { LostGroundCallout } from '../lostGround/LostGroundCallout'
import type { PageChrome } from '../projects/chrome'
import { useHashQuery } from '../utils/hashQuery'
import { pageScopeRefs } from '../visibility/aiContext'
import { exportHash, navigateHash, promptHash, runningHash } from '../shell/routes'
import { EmptyState, LinkButton, TabPanel, Tabs, type TabItem } from '../ui'
import { Leaderboard } from './Leaderboard'
import { formatDay, formatMoment } from './model'
import { PromptGrid } from './PromptGrid'
import type { ResultsAssistScope } from './ResultsAssists'
import { BaselineSection } from './results/BaselineSection'
import { CannibalizingCard, CitedInsteadCard } from './results/CitedSections'
import { useResultsDrills } from './results/drills'
import { FunnelCard } from './results/FunnelCard'
import { KpiTiles } from './results/KpiTiles'
import { OpportunitiesCard } from './results/OpportunitiesCard'
import { ScopeCard } from './results/ScopeCard'
import { StagesSection } from './results/StagesSection'
import { SummaryLine } from './results/SummaryLine'
import {
  RESULTS_QUERY,
  RESULTS_TABS_ID,
  resultsTabFrom,
  resultsView,
  type ResultsTab
} from './results/tabs'
import { TopActions } from './TopActions'
import './m3.css'
import './results/results.css'

type PageResultsProps = {
  pageId: string
  projectName: string
  page: PageChrome
  marketId: string
  /** The check these results are from, when the route pinned one. Drill targets keep it. */
  runId?: string | null
  results: PageResults
  /** Turns on the Claude assists. Harnesses without a project leave it out. */
  assists?: ResultsAssistScope
  /**
   * More of "Who gets cited", drawn at the end of that tab: the shell passes
   * the citations screen ("Sources Google listed").
   */
  sources?: ReactNode
} & (
  | {
      /**
       * Page header, tabs, and sponsor. The production shell already draws those
       * and passes `false`. Harness and tests keep the default.
       */
      chrome?: true
      onMarketChange: (marketId: string) => void
    }
  | { chrome: false; onMarketChange?: undefined }
)

/**
 * Page results (v2 results layout, Topic-Overview.png): the source strip,
 * four equal KPI tiles, the summary line with its one AI menu, then tabs —
 * Prompts (the list grid grouped by outcome), Breakdown, Who gets cited,
 * Top actions and Checks. Every number, bar, segment and row opens what it
 * counts (REPORT-SPEC "Interaction model"); the screen shares the shell's
 * drill drawer.
 */
export function PageResultsScreen(props: PageResultsProps): JSX.Element {
  return (
    <DrillHost>
      <ResultsBody {...props} />
    </DrillHost>
  )
}

function ResultsBody(props: PageResultsProps): JSX.Element {
  const { pageId, projectName, page, marketId, results } = props
  const runId = props.runId ?? null
  const chrome = props.chrome !== false
  const market = page.markets.find((item) => item.id === marketId) ?? page.markets[0]
  const drills = useResultsDrills(results, { pageId, market, runId })
  const [query, setQuery] = useHashQuery(RESULTS_QUERY)
  const tab = resultsTabFrom(query.view)
  const run = results.run
  const aio = drills.get('kpi:aio')?.rows.length ?? run?.promptsWithAio ?? 0
  const previous = results.comparison.find((column) => column.which === 'previous')
  const since = formatMoment(previous?.finishedAt ?? null)
  // The grid's narrow "Since …" column header keeps the short day; the tiles show the time.
  const sinceDay = formatDay(previous?.finishedAt ?? null, { year: false })
  const checks = results.comparison.filter((column) => column.runId).length
  useAiContext({
    entities: pageScopeRefs({
      pageId,
      page: page.label || page.title || page.displayUrl,
      market: market ?? null,
      runId,
      checkedAt: results.scope.checkedAt
    }),
    filters: { tab }
  })

  const tabs: TabItem<ResultsTab>[] = [
    { id: 'prompts', label: 'Questions', count: results.prompts.length },
    { id: 'breakdown', label: 'Breakdown' },
    { id: 'cited', label: 'Who gets cited', count: results.leaderboard.length },
    { id: 'actions', label: 'Top actions', count: results.topActions.length },
    { id: 'checks', label: 'Checks', count: checks }
  ]

  function pick(next: ResultsTab): void {
    // The ticked prompts belong to the Prompts tab, so another tab drops them.
    setQuery({ view: resultsView(next), sel: null })
  }

  return (
    <div className="page-stack m3-screen m3-results" data-nfr-screen="page-results">
      <div className="m3-results-top" id="m3-results-top">
        {chrome ? (
          <PageHeader
            projectName={projectName}
            page={page}
            marketId={marketId}
            onMarketChange={props.onMarketChange}
            checkHref={runningHash(pageId)}
            exportHref={exportHash(pageId, marketId)}
          />
        ) : null}
        {chrome ? <PageTabs pageId={pageId} activeTab="results" /> : null}

        <ScopeCard pageId={pageId} page={page} market={market} results={results} drills={drills} />

        {run ? (
          <KpiTiles pageId={pageId} results={results} drills={drills} since={since} />
        ) : (
          <EmptyState
            icon="inbox"
            title="No check in this market yet"
            body="Press Check now to see which AI Overviews cite this page. The numbers show up here when it finishes."
            action={
              <LinkButton href={runningHash(pageId)} variant="secondary">
                Check now
              </LinkButton>
            }
          />
        )}

        {run ? (
          <SummaryLine
            results={results}
            drills={drills}
            hasPrevious={previous !== undefined}
            {...(props.assists ? { assists: props.assists } : {})}
          />
        ) : null}
        {run ? <LostGroundCallout pageId={pageId} rows={results.prompts} /> : null}
      </div>

      {run ? (
        <div className="m3-results-tabs">
          <Tabs
            label="Results sections"
            size="sm"
            tabs={tabs}
            value={tab}
            onChange={pick}
            panelId={RESULTS_TABS_ID}
          />
          <TabPanel panelId={RESULTS_TABS_ID} id={tab} className="m3-results-panel">
            {tab === 'prompts' ? (
              <PromptGrid
                prompts={results.prompts}
                domain={drills.scope.domain}
                sinceLabel={sinceDay}
                checkLabel={formatMoment(results.scope.checkedAt)}
                drills={drills}
                {...(props.assists
                  ? { questions: { projectId: props.assists.projectId, samples: page.samples } }
                  : {})}
                onOpen={(promptId) =>
                  navigateHash(
                    promptHash(pageId, promptId, { marketId: drills.scope.marketId, runId })
                  )
                }
              />
            ) : null}
            {tab === 'breakdown' ? (
              <>
                <div className="m3-pair">
                  <FunnelCard results={results} drills={drills} />
                  <OpportunitiesCard results={results} drills={drills} aio={aio} />
                </div>
                <StagesSection results={results} drills={drills} />
              </>
            ) : null}
            {tab === 'cited' ? (
              <>
                <Leaderboard
                  results={results}
                  aio={aio}
                  drills={drills}
                  projectId={props.assists?.projectId ?? null}
                />
                <div className="m3-pair" id="m3-cited">
                  <CitedInsteadCard results={results} drills={drills} aio={aio} />
                  <CannibalizingCard pageId={pageId} results={results} drills={drills} />
                </div>
                {props.sources}
              </>
            ) : null}
            {tab === 'actions' ? (
              <TopActions
                pageId={pageId}
                results={results}
                drills={drills}
                {...(props.assists ? { assists: props.assists } : {})}
              />
            ) : null}
            {tab === 'checks' ? (
              <BaselineSection pageId={pageId} results={results} drills={drills} />
            ) : null}
          </TabPanel>
        </div>
      ) : null}

      {chrome ? <SponsorSlot /> : null}
    </div>
  )
}
