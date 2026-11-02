import type { JSX, ReactNode } from 'react'
import { TabPanel, useScreenView, ViewTabs, type ScreenViewStore } from '../../ui'
import { GridView } from '../../topics/views/components/GridView'
import { PagesView } from '../../topics/views/components/PagesView'
import { TreeView } from '../../topics/views/components/TreeView'
import type { ViewEnv } from '../../topics/views/types'
import { QUESTIONS_VIEWS, type QuestionsScreenView } from '../../topics/views/url'

const PANEL_ID = 'questions-views'

/**
 * The Questions screen's views, in the topic's one row of tabs: Tree (Topic › Result ›
 * Search), Grid (topic × result), List (the question list with its filters and bulk
 * actions) and Pages. The view is in the URL (`view=tree`) and remembered per project.
 * Every view shows the engine filter's pick: the rows come re-counted on that engine.
 */
export function QuestionsViews({
  env,
  projectId,
  list,
  viewStore
}: {
  env: ViewEnv
  projectId: string
  /** The List view: filters, the question grid and its drawers. */
  list: ReactNode
  /** Tests only: where the picked view is remembered (null keeps nothing). */
  viewStore?: ScreenViewStore | null
}): JSX.Element {
  const screen = useScreenView<QuestionsScreenView>('questions', QUESTIONS_VIEWS, 'list', {
    projectId,
    ...(viewStore !== undefined ? { store: viewStore } : {})
  })
  return (
    <>
      <ViewTabs<QuestionsScreenView>
        label="Questions views"
        panelId={PANEL_ID}
        views={QUESTIONS_VIEWS}
        value={screen.view}
        onChange={screen.setView}
        hrefFor={screen.hrefFor}
      />
      <TabPanel panelId={PANEL_ID} id={screen.view}>
        {screen.view === 'tree' ? (
          <TreeView env={env} mode="source" label="Every search by topic and result" />
        ) : screen.view === 'grid' ? (
          <GridView env={env} />
        ) : screen.view === 'pages' ? (
          <PagesView env={env} />
        ) : (
          list
        )}
      </TabPanel>
    </>
  )
}
