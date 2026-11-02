import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { AllPageRow, ProjectDetail } from '@shared/ipc'
import { DrillHost } from '../drill'
import {
  Button,
  Confirm,
  DomainText,
  EmptyState,
  LinkButton,
  SectionHead,
  ViewTabs,
  useScreenView
} from '../ui'
import { ScreenHeader } from '../components/Header'
import { LoadError } from '../components/LoadError'
import { PAGES_VIEWS, isPagesView, replaceHash, sectionHash } from '../shell/routes'
import { useEngineRevision } from '../shell/engineRevision'
import { useChangeVersion } from '../shell/changes'
import { openDrawer } from '../shell/drawers'
import { createStructureClient, type StructureClient } from '../structure/client'
import { usePagesRevision } from '../structure/drawers'
import { patchHashQuery } from '../utils/hashQuery'
import { useQueryState } from '../utils/queryState'
import { messageOf } from '../grid/hooks/useSavedViews'
import { ClustersSection } from './components/ClustersSection'
import { PagesGrid } from './components/PagesGrid'
import { Tiles } from './components/Tiles'
import { NeedsAttention } from './components/NeedsAttention'
import { AttentionBar } from './components/AttentionBar'
import { ATTENTION_COLLAPSE_ROWS } from './utils/attention'
import { useGridKey } from './hooks/useGridKey'
import { useRowActions } from './hooks/useRowActions'
import { useAllPages } from './hooks/useAllPages'
import { usePageDrill } from './hooks/usePageDrill'
import { useProjectExtras } from './hooks/useProjectExtras'
import { dueDrill } from './utils/drills'
import { rowName } from './utils/text'
import { createAllPagesSource, type AllPagesSource } from './source'
import { PagesTree } from './tree/PagesTree'
import { PageChangeBanner } from '../pageChanges/PageChangeBanner'
import { usePageChangeActions, usePageChanges } from '../pageChanges/hooks'
import './allPages.css'

/**
 * All pages at scale (SRS 4.20, Mockups/Home.dc.html): tiles, one "Needs
 * attention" list ("Wrong page cited" and own pages cited but not tracked),
 * and the standard grid over every found page with bulk actions.
 */
export function AllPagesScreen(props: AllPagesProps): JSX.Element {
  return (
    <DrillHost>
      <AllPagesBody {...props} />
    </DrillHost>
  )
}

interface AllPagesProps {
  /** Tests and the mock build pass a source. Production uses the preload bridge. */
  source?: AllPagesSource
  /** Site structure (the Tree view). Tests pass a fake; production uses the preload bridge. */
  structureClient?: StructureClient
  project: ProjectDetail | null
  /**
   * Deep-link query from `pagesHash` (`#/pages?preset=…`): `preset` is a grid preset
   * id (all, tracked, lost, due, untracked, today), `folder` a folder value,
   * `cluster` / `group` a cluster or group id, `market` a market id. `view` is
   * List or Tree; in Tree, `part` is the Site structure part and `focus` an old
   * cluster or group link.
   */
  params?: Readonly<Record<string, string>> | undefined
  onPin: (page: { id: string; pinned: boolean }) => Promise<void>
  onOpenPage: (pageId: string) => void
}

function AllPagesBody({
  source: given,
  structureClient: givenStructure,
  project,
  params,
  onPin,
  onOpenPage
}: AllPagesProps): JSX.Element {
  const source = useMemo(() => given ?? createAllPagesSource(), [given])
  const structureClient = useMemo(() => givenStructure ?? createStructureClient(), [givenStructure])
  const engineRevision = useEngineRevision()
  // A drawer over this screen (Move pages, Rename) changed pages: reload in place.
  const pagesRevision = usePagesRevision()
  const revision = engineRevision * 100_000 + pagesRevision
  const projectId = project?.id ?? null
  const state = useAllPages(source, projectId, revision)
  const [attention, setAttention] = useQueryState('attention', { history: 'push' })
  const views = useMemo(
    () => (projectId ? source.views(projectId, 'all-pages') : null),
    [source, projectId]
  )
  const { reload, reloadRows } = state
  const extras = useProjectExtras(source, projectId, revision)
  // "Is this a fix?": changes seen on the pages that nobody logged yet.
  const pageChanges = usePageChanges(projectId)
  const changeActions = usePageChangeActions(projectId ?? '')
  // A logged fix or "Not a fix" changes the grid's "Changed, not logged" column.
  const decided = useChangeVersion('pageChanges') * 10_000 + useChangeVersion('fixes')
  const firstDecided = useRef(decided)
  useEffect(() => {
    if (decided !== firstDecided.current) reloadRows()
  }, [decided, reloadRows])
  const marketList = state.data?.markets
  const markets = useMemo(
    () => new Map<string, Market>((marketList ?? []).map((market) => [market.id, market])),
    [marketList]
  )
  const drill = usePageDrill(source, projectId ?? '', markets)
  const domain = state.data?.domain ?? project?.domain ?? ''
  const due = useMemo(
    () => (extras.due ? dueDrill(extras.due, markets, domain) : null),
    [extras.due, markets, domain]
  )
  const showGrid = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('pages-title')?.scrollIntoView({ block: 'start' })
    })
  }, [])
  const [message, setMessage] = useState<string | null>(null)
  const gridKey = useGridKey(params)
  // List (every page in the grid) or Tree (folders, then the rest of Site structure).
  const screenView = useScreenView('pages', PAGES_VIEWS, 'list', { projectId })
  // An old `#/pages?view=tracked` link: the preset moves to `preset`, so `view`
  // is free for List / Tree. Other values (an open drawer) stay.
  const legacyPreset = params?.view && !isPagesView(params.view) ? params.view : null
  useLayoutEffect(() => {
    if (legacyPreset === null) return
    replaceHash(patchHashQuery(window.location.hash, { view: null, preset: legacyPreset }))
  }, [legacyPreset])
  const track = useCallback(
    (row: AllPageRow) => {
      if (projectId === null) return
      source.trackUrl({ projectId, url: row.url }).then(
        (result) => {
          setMessage(`${rowName(row)}: ${result.message}`)
          reloadRows()
        },
        (cause: unknown) => setMessage(messageOf(cause, 'Could not track that page.'))
      )
    },
    [source, projectId, reloadRows]
  )

  const pin = useCallback(
    (row: AllPageRow) => {
      void onPin({ id: row.id, pinned: row.pinned }).then(
        () => reloadRows(),
        (cause: unknown) => setMessage(messageOf(cause, 'Could not update the pin.'))
      )
    },
    [onPin, reloadRows]
  )
  const { setPageRole: setRole } = source
  const setPageRole = useMemo(
    () =>
      setRole && projectId !== null
        ? (pageId: string, clusterId: string, role: 'pillar' | 'supporting' | 'orphan') =>
            setRole({ projectId, clusterId, pageId, role })
        : null,
    [setRole, projectId]
  )
  const rowActions = useRowActions({
    source,
    projectId,
    reloadRows,
    onOpenPage,
    onPin: pin,
    onTrack: track,
    setPageRole
  })
  const { notice, setNotice } = rowActions
  const showMessage = useCallback(
    (text: string) => {
      setMessage(null)
      setNotice({ text })
    },
    [setNotice]
  )

  const header = (
    <ScreenHeader
      title="All pages"
      subtitle={project ? <DomainText domain={project.domain} /> : undefined}
      primary={
        project
          ? {
              label: 'Add a page',
              icon: 'plus',
              onClick: () => openDrawer('add-page'),
              guide: 'pages-add'
            }
          : undefined
      }
      more={
        project
          ? [
              {
                id: 'ap-import-pages',
                label: 'Import pages',
                icon: 'download',
                href: sectionHash('import-pages')
              }
            ]
          : undefined
      }
      moreLabel="Page actions"
    />
  )

  if (!project) {
    return (
      <div className="page-stack">
        {header}
        <div className="ap-card">
          <EmptyState
            title="No project yet"
            body="Create a project to start tracking pages."
            action={
              <LinkButton variant="primary" size="sm" href={sectionHash('new-project')}>
                New project
              </LinkButton>
            }
          />
        </div>
      </div>
    )
  }

  const { data, review } = state
  // Over a long grid, Needs attention is one line until Review (`?attention=open`).
  const collapsible = (data?.rows.length ?? 0) > ATTENTION_COLLAPSE_ROWS
  const line = message ?? drill.error ?? notice?.text ?? null
  const viewTabs = (
    <ViewTabs
      label="Pages views"
      views={PAGES_VIEWS}
      value={screenView.view}
      onChange={screenView.setView}
      hrefFor={screenView.hrefFor}
    />
  )
  if (screenView.view === 'tree') {
    return (
      <div className="page-stack ap-screen">
        {header}
        {viewTabs}
        {state.error ? (
          <LoadError title="Could not load the pages" message={state.error} onRetry={reload} />
        ) : data ? (
          <PagesTree
            project={project}
            client={structureClient}
            rows={data.rows}
            domain={data.domain}
            onOpenPage={(row) => onOpenPage(row.id)}
            onCited={(row) => drill.open('cited', row)}
            onPagesChanged={reloadRows}
          />
        ) : (
          <p role="status" className="muted">
            Loading pages…
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="page-stack ap-screen">
      {header}
      {viewTabs}
      <PageChangeBanner list={pageChanges.list} actions={changeActions} />
      <Tiles data={data} paused={project.status === 'paused'} due={due} onShowGrid={showGrid} />
      {data && review && (review.wrongPage.length > 0 || review.untracked.length > 0) ? (
        collapsible && attention !== 'open' ? (
          <AttentionBar review={review} onOpen={() => setAttention('open')} />
        ) : (
          <NeedsAttention
            source={source}
            projectId={project.id}
            domain={data.domain}
            review={review}
            markets={markets}
            onChanged={reloadRows}
            {...(collapsible ? { onCollapse: () => setAttention(null) } : {})}
          />
        )
      ) : null}
      {extras.clusters ? (
        <ClustersSection list={extras.clusters} markets={markets} onShowGrid={showGrid} />
      ) : null}
      <div className="ap-section">
        <SectionHead id="pages-title" title="Pages" />
        {line ? (
          <div className="ap-message ap-notice" role="status">
            <span>{line}</span>
            {notice?.undo && line === notice.text ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const undo = notice.undo
                  setNotice(null)
                  undo?.()
                }}
              >
                Undo
              </Button>
            ) : null}
          </div>
        ) : null}
        {state.error ? (
          <LoadError title="Could not load the pages" message={state.error} onRetry={reload} />
        ) : data ? (
          <PagesGrid
            key={gridKey.key}
            onLinkWritten={gridKey.written}
            data={data}
            params={params}
            source={source}
            views={views}
            exportCsv={source.exportCsv}
            exportName={`${project.slug}-all-pages`}
            onOpenPage={onOpenPage}
            onDrill={drill.open}
            rowActions={rowActions.actions}
            bulkDrawers={rowActions.drawers}
            onMessage={showMessage}
            onBulkDone={(outcome) => {
              setMessage(null)
              const stopped = outcome.stopped
              setNotice(
                stopped
                  ? { text: outcome.message, undo: () => rowActions.undoStopped(stopped) }
                  : { text: outcome.message }
              )
              if (outcome.changed) reloadRows()
            }}
          />
        ) : (
          <p role="status" className="muted">
            Loading pages…
          </p>
        )}
      </div>
      {rowActions.stopping ? (
        <Confirm
          title={`Stop tracking ${rowName(rowActions.stopping)}?`}
          body="History stays; no more searches are used."
          confirmLabel="Stop tracking"
          busy={rowActions.stopBusy}
          onConfirm={rowActions.confirmStop}
          onCancel={rowActions.cancelStop}
          testId="stop-tracking-confirm"
        />
      ) : null}
    </div>
  )
}
