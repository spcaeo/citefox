import type { JSX, ReactNode } from 'react'
import { TabPanel, useScreenView, ViewTabs, type ScreenViewStore } from '../../ui'
import type { TopicResults } from '../results/types'
import { isQuietFirstCheck } from './components/firstCheck'
import { FirstCheckCard } from './components/FirstCheckCard'
import { GridView } from './components/GridView'
import { ListView } from './components/ListView'
import { PagesView } from './components/PagesView'
import { SummaryCard } from './components/SummaryCard'
import { TreeView } from './components/TreeView'
import { fixesForTopicHash } from './hooks/useTopicEnv'
import type { useViewQuery } from './hooks/useViewQuery'
import { pageFixCount, totalsOf, type Search } from './model'
import type { ViewEnv } from './types'
import { TOPIC_VIEWS, type TopicView } from './url'

const PANEL_ID = 'topic-views'

/**
 * A topic's body under its header: the summary card (or the calm first-check card),
 * the one row of view tabs (List · Tree · Grid · Pages | Progress, remembered per
 * project and in the URL; List is the default), and the chosen view. The Tree starts
 * closed, with Expand all.
 */
export function TopicViews({
  results,
  projectId,
  env,
  query,
  progress,
  onMove,
  fileName,
  viewStore,
  ai
}: {
  results: TopicResults
  projectId: string
  env: ViewEnv
  query: ReturnType<typeof useViewQuery>
  /** The existing Progress screen. */
  progress: ReactNode
  onMove: (searches: readonly Search[]) => void
  fileName: string
  /** Tests only: where the picked view is remembered (null keeps nothing). */
  viewStore?: ScreenViewStore | null
  /** The topic's one AI menu, in the summary card. */
  ai?: ReactNode
}): JSX.Element {
  const { topic } = results
  const screen = useScreenView<TopicView>('topic', TOPIC_VIEWS, 'list', {
    projectId,
    ...(viewStore !== undefined ? { store: viewStore } : {})
  })
  const totals = totalsOf(env.searches)
  const pageFixes = pageFixCount(env.searches)
  const fixesHref = fixesForTopicHash(topic.id)
  const fullChecks = results.progress.filter((point) => !point.partial).length
  const quiet = isQuietFirstCheck(env.searches, fullChecks)
  return (
    <>
      {quiet ? (
        <FirstCheckCard
          searches={env.searches}
          targetUrl={topic.targetPage}
          nextCheck={env.nextCheck}
          pageFixes={pageFixes}
          fixesHref={fixesHref}
          onStart={env.openSearch}
        />
      ) : null}
      <SummaryCard
        totals={totals}
        pageFixes={pageFixes}
        fixesHref={fixesHref}
        drillHref={env.drillHref}
        actions={screen.view === 'progress' ? null : ai}
        checking={results.live?.state === 'running'}
      />
      <ViewTabs<TopicView>
        label="Topic views"
        panelId={PANEL_ID}
        views={['list', 'tree', 'grid', 'pages']}
        trailing={{
          id: 'progress',
          count: fullChecks
        }}
        value={screen.view}
        onChange={screen.setView}
        hrefFor={screen.hrefFor}
      />
      <TabPanel panelId={PANEL_ID} id={screen.view}>
        {screen.view === 'tree' ? (
          <TreeView
            env={env}
            label={`${topic.name}: searches by stage and result`}
            {...(quiet ? { mode: 'result' as const } : {})}
          />
        ) : screen.view === 'grid' ? (
          <GridView env={env} />
        ) : screen.view === 'list' ? (
          <ListView
            env={env}
            label={`${topic.name}: every search`}
            selection={query.sel}
            onSelectionChange={query.setSel}
            onMove={onMove}
            fileName={fileName}
          />
        ) : screen.view === 'pages' ? (
          <PagesView env={env} />
        ) : (
          progress
        )}
      </TabPanel>
    </>
  )
}
