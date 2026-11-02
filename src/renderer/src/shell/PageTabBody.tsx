import { lazy, Suspense, type JSX } from 'react'
import type { PageDetail } from '@shared/ipc'
import { AudienceScreen } from '../pageSetup/AudienceScreen'
import { GapsScreen } from '../pageSetup/GapsScreen'
import { PromptsScreen } from '../pageSetup/PromptsScreen'
import { BeforeFirstCheck } from '../pageSetup/pipeline'
import type { ShellClient } from '../projects/client'
import { pageChromeFromDetail } from '../projects/copy'
import type { TemplatesClient } from '../templates/client'
import type { PageTabId } from './routes'

const CitationsScreen = lazy(() =>
  import('../visibility/CitationsScreen').then((module) => ({ default: module.CitationsScreen }))
)
const ScoresScreen = lazy(() =>
  import('../visibility/ScoresScreen').then((module) => ({ default: module.ScoresScreen }))
)
const MarketsScreen = lazy(() =>
  import('../markets').then((module) => ({ default: module.MarketsScreen }))
)
const HistoryScreen = lazy(() =>
  import('../history').then((module) => ({ default: module.HistoryScreen }))
)
const CommunitiesScreen = lazy(() =>
  import('../communities').then((module) => ({ default: module.CommunitiesScreen }))
)
const SentimentScreen = lazy(() =>
  import('../sentiment').then((module) => ({ default: module.SentimentScreen }))
)
const ResultsPanel = lazy(() =>
  import('../m3/ResultsPanel').then((module) => ({ default: module.ResultsPanel }))
)

export interface PageTabBodyProps {
  client: ShellClient
  templatesClient: TemplatesClient
  projectId: string
  projectName: string
  page: PageDetail
  tab: PageTabId
  marketId: string
  /** A check pinned by the route (`?run=`). Null is the latest check. Results reads it. */
  runId?: string | null
  /**
   * A tab-defined filter or focus from the route (`?filter=`). Content gaps reads
   * `row:<promptId>` (open that row), Progress reads `fix:<n>` (scroll to that fix).
   */
  filter?: string | null
  onChanged: () => void
}

/**
 * The open page tab's screen. The shell draws the page header and tabs around it.
 *
 * Keyed by tab, so every tab change mounts a fresh screen. Several tabs return a
 * bare `<Suspense>` at the same spot; without the key React reuses that boundary,
 * and while the next tab's lazy chunk loads it keeps the previous screen hidden
 * with its state. Coming back (Progress → Results still loading → Progress) then
 * revived the old screen, which never read the new hash ("Plan as Fix N").
 */
export function PageTabBody(props: PageTabBodyProps): JSX.Element {
  return <TabScreen key={props.tab} {...props} />
}

function TabScreen({
  client,
  templatesClient,
  projectId,
  projectName,
  page,
  tab,
  marketId,
  runId = null,
  filter = null,
  onChanged
}: PageTabBodyProps): JSX.Element {
  if (tab === 'audience') {
    return (
      <AudienceScreen
        client={client}
        templatesClient={templatesClient}
        projectId={projectId}
        page={page}
        onChanged={onChanged}
      />
    )
  }
  if (tab === 'prompts') {
    return (
      <PromptsScreen
        client={client}
        templatesClient={templatesClient}
        projectId={projectId}
        page={page}
        marketId={marketId}
        filter={filter}
        onChanged={onChanged}
      />
    )
  }
  if (tab === 'gaps') {
    return (
      <GapsScreen
        client={client}
        templatesClient={templatesClient}
        projectId={projectId}
        page={page}
        marketId={marketId}
        focus={filter}
        onChanged={onChanged}
      />
    )
  }
  if (tab === 'results') {
    const market = page.markets.find((item) => item.id === marketId) ?? page.markets[0]
    const results = (
      <Suspense fallback={<p role="status">Loading results…</p>}>
        <ResultsPanel
          projectId={projectId}
          projectName={projectName}
          pageId={page.id}
          page={pageChromeFromDetail(page)}
          marketId={marketId || null}
          runId={runId}
          sources={
            <Suspense fallback={<p role="status">Loading citations…</p>}>
              <CitationsScreen
                projectId={projectId}
                pageId={page.id}
                marketId={marketId || null}
                market={market}
                runId={runId}
                withSharedSections={false}
              />
            </Suspense>
          }
        />
      </Suspense>
    )
    // A page never checked shows its automatic setup, then "Start first check".
    if (page.score === null && runId === null) {
      return <BeforeFirstCheck page={page} onChanged={onChanged} results={results} />
    }
    return results
  }
  if (tab === 'markets') {
    return (
      <Suspense fallback={<p role="status">Loading markets…</p>}>
        <MarketsScreen projectId={projectId} page={page} onChanged={onChanged} />
      </Suspense>
    )
  }
  if (tab === 'communities') {
    return (
      <Suspense fallback={<p role="status">Loading communities…</p>}>
        <CommunitiesScreen
          projectId={projectId}
          pageId={page.id}
          marketId={marketId || null}
          markets={page.markets}
        />
      </Suspense>
    )
  }
  if (tab === 'progress') {
    const market = page.markets.find((item) => item.id === marketId) ?? page.markets[0]
    return (
      <Suspense fallback={<p role="status">Loading scores…</p>}>
        <ScoresScreen
          projectId={projectId}
          pageId={page.id}
          marketId={marketId || null}
          market={market}
          markets={page.markets}
          runId={runId}
          focus={filter}
        />
      </Suspense>
    )
  }
  if (tab === 'sentiment') {
    return (
      <Suspense fallback={<p role="status">Loading sentiment…</p>}>
        <SentimentScreen projectId={projectId} page={page} marketId={marketId} />
      </Suspense>
    )
  }
  if (tab === 'history') {
    return (
      <Suspense fallback={<p role="status">Loading history…</p>}>
        <HistoryScreen
          projectId={projectId}
          pageId={page.id}
          marketId={marketId || null}
          markets={page.markets}
        />
      </Suspense>
    )
  }
  return unknownTab(tab)
}

/** Every tab in PAGE_TABS has a screen above; a new tab fails typecheck here. */
function unknownTab(tab: never): never {
  throw new Error(`No screen for page tab ${String(tab)}`)
}
