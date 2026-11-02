import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import type { QuestionSource } from '@shared/ipc'
import { useAiContext } from '../../assistant/context/useAiContext'
import { checkParamsPatch } from '../../checkNow/model'
import { ScreenHeader } from '../../components/Header'
import { errorText } from '../../components/errorText'
import { DrillHost } from '../../drill'
import { useEngineFilter } from '../../engines/useEngineFilter'
import { useEngineSummary } from '../../engines/useEngineSummary'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { withDrawerOpened } from '../../shell/drawerUrl'
import { withShellDialog } from '../../shell/overlay'
import { navigateHash, replaceHash, topicHash } from '../../shell/routes'
import {
  Button,
  EmptyState,
  IconButton,
  HelpFillPair,
  showUndo,
  TabPanel,
  useScreenView,
  ViewTabs,
  type MenuItem,
  ResultWordsProvider,
  type ScreenViewStore
} from '../../ui'
import { useHashQuery } from '../../utils/hashQuery'
import {
  bandText,
  createClustersSource,
  DEFAULT_QUESTION_BAND,
  notifyTopicsChanged
} from '../clusters'
import type { ClustersSource } from '../clusters'
import { duplicateTopics, mergeTopics, removeTopics, setTopicsPaused } from '../settings/actions'
import { dashboard, NO_FOLDER, rowsOnEngine, withEngine, type DashFolder } from '../views/model'
import { NewEmptyTopic } from './components/NewEmptyTopic'
import { SuggestTopics } from './components/SuggestTopics'
import { TopicActionDrawer, type ActionDone } from './components/TopicActionDrawer'
import { TopicDeleteConfirm } from './components/TopicDeleteConfirm'
import { topicRowMenu, type TopicGridActions } from './components/topicMenu'
import { TopicsGrid } from './components/TopicsGrid'
import { DashGrid } from './dashboard/DashGrid'
import { DashKpis } from './dashboard/DashKpis'
import { DashTree } from './dashboard/DashTree'
import { FolderDrawer } from './dashboard/FolderDrawer'
import { dashRows, folderKey, inFolder, isFolderMode } from './dashboard/rows'
import { useSuggestTopics } from './hooks/useSuggestTopics'
import { usePageFixCount } from '../../fixes/hooks/usePageFixCount'
import { useEngineRevision } from '../../shell/engineRevision'
import { useTopicsData } from './hooks/useTopicsData'
import { topicsHashWith, topicsViewHash, useTopicsUrl } from './hooks/useTopicsUrl'
import { topicLines, type TopicAction, type TopicLine } from './model'
import '../views/topicViews.css'
import './topics-list.css'

/** The status line under the header: the last action's words, and Undo after a delete. */
interface Notice {
  message: string
  tone: 'ok' | 'bad'
  undo?: { id: string; name: string }
}

/** Runs a topic action; its failure shows in the status line. */
type Run = (act: () => Promise<unknown>, fallback: string) => Promise<void>

/** The dashboard's views (`view=`), remembered per project. */
const DASH_VIEWS = ['list', 'tree', 'grid'] as const
type DashView = (typeof DASH_VIEWS)[number]
const PANEL_ID = 'topics-views'

/**
 * Topics (`#/topics`, board Main): the KPI strip, then every tracked topic as a Tree
 * (Folder › Topic), a Grid (folder × result) or a List, with "+ New topic" and Move to
 * folder; Claude's topic ideas. The view, a folder filter (`folder=`), the row action
 * and the Suggest section live in the URL.
 */
export function TopicsScreen({
  projectId,
  source: given,
  viewStore
}: {
  projectId: string
  /** Tests pass a fake. Production uses the preload bridge. */
  source?: ClustersSource
  /** Tests only: where the picked view is remembered (null keeps nothing). */
  viewStore?: ScreenViewStore | null
}): JSX.Element {
  const source = useMemo(() => given ?? createClustersSource(), [given])
  const { view, update, openAction, closeAction } = useTopicsUrl()
  const screen = useScreenView<DashView>('topics', DASH_VIEWS, 'list', {
    projectId,
    ...(viewStore !== undefined ? { store: viewStore } : {})
  })
  const [{ folder: folderFilter }, setQuery] = useHashQuery(['folder'] as const)
  const folderDrawer = useDrawerEntry('topic-folder')
  const { state, reload } = useTopicsData(source, projectId)
  // The page fixes the topics feed, counted by the same rule as Fixes.
  const revision = useEngineRevision()
  const topicFixes = usePageFixCount(projectId, revision, undefined, 'topics')
  // Every page fix Fixes shows, so the KPI can say "14 of the 15" when pages feed some.
  const allFixes = usePageFixCount(projectId, revision)
  const suggest = useSuggestTopics(source, projectId)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const data = state.data

  const sources = useMemo(
    () =>
      new Map<string, QuestionSource>((data?.list.sources ?? []).map((item) => [item.id, item])),
    [data]
  )
  // The engine filter (`?engine=chatgpt`): All and Google AI Overview show Google's
  // results; another engine re-counts every topic from its answers (audit #4).
  const topicIds = useMemo(() => (data ? data.topics.map((topic) => topic.id) : null), [data])
  const engineSummary = useEngineSummary(data ? source['engines:summary'] : undefined, projectId, {
    pageIds: topicIds,
    marketId: data?.list.marketId ?? null,
    reload: data
  })
  const engineFilter = useEngineFilter(engineSummary.engines)
  const engine = engineFilter.engine
  const list = useMemo(
    () =>
      data
        ? {
            ...data.list,
            rows: rowsOnEngine(data.list.rows, engine, engineSummary.questions, data.list.marketId)
          }
        : null,
    [data, engine, engineSummary.questions]
  )
  const lines = useMemo(() => (data && list ? topicLines(data.topics, list) : []), [data, list])
  const board = useMemo(
    () => (data && list ? dashboard(data.topics, data.folders, list.rows) : null),
    [data, list]
  )
  const rows = useMemo(() => (board ? dashRows(board, lines) : []), [board, lines])
  const marketId = data?.list.marketId ?? null
  const kpiRows = useMemo(() => lines.flatMap((line) => line.rows), [lines])
  const domain = data?.list.lens.ownDomain ?? 'your site'
  const market = data?.list.markets.find((item) => item.id === marketId)
  useAiContext({
    entities: market ? [{ kind: 'market', id: market.id, label: market.label }] : [],
    filters: { view: screen.view, ...(folderFilter ? { folder: folderFilter } : {}) }
  })

  const openLine = useCallback(
    (line: Pick<TopicLine, 'id'>) => {
      replaceHash(topicsViewHash({ ...view, action: null, topic: null, row: line.id }))
      navigateHash(withEngine(topicHash(line.id), engine))
    },
    [view, engine]
  )
  const onAction = useCallback(
    (action: TopicAction, line: TopicLine) => openAction(action, line.id),
    [openAction]
  )
  // Rename is Topic settings now: an old `?action=rename&topic=<id>` link opens that drawer.
  useEffect(() => {
    if (view.action !== 'rename' || view.topic === null) return
    replaceHash(
      withDrawerOpened(topicsViewHash({ ...view, action: null, topic: null }), 'topic-settings', {
        'ts.topic': view.topic
      })
    )
  }, [view])
  const onDone = useCallback(
    (done: ActionDone) => {
      setNotice(
        done.toasted
          ? null
          : { message: done.message, tone: 'ok', ...(done.deleted ? { undo: done.deleted } : {}) }
      )
      closeAction()
      notifyTopicsChanged()
    },
    [closeAction]
  )
  const undo = useCallback(
    async (topic: { id: string; name: string }) => {
      try {
        await source['topics:update']({ projectId, topicId: topic.id, status: 'tracked' })
        setNotice({ message: `${topic.name} is back.`, tone: 'ok' })
        notifyTopicsChanged()
      } catch (cause) {
        setNotice({ message: errorText(cause, 'Could not undo the delete.'), tone: 'bad' })
      }
    },
    [source, projectId]
  )

  const run = useCallback<Run>(async (act, fallback) => {
    setBusy(true)
    try {
      await act()
      setNotice(null)
    } catch (cause) {
      setNotice({ message: errorText(cause, fallback), tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }, [])

  const gridActions: TopicGridActions = {
    onSettings: (line) => openDrawer('topic-settings', { 'ts.topic': line.id }),
    onRename: async (line, name) => {
      const before = line.name
      await source['topics:update']({ projectId, topicId: line.id, name })
      notifyTopicsChanged()
      showUndo({
        message: `Renamed to ${name}.`,
        undo: async () => {
          await source['topics:update']({ projectId, topicId: line.id, name: before })
          notifyTopicsChanged()
        },
        testId: 'topic-undo'
      })
    },
    onPause: (picked, paused) =>
      void run(
        () => setTopicsPaused(source, projectId, picked, paused),
        paused ? 'Could not pause checks.' : 'Could not resume checks.'
      ),
    onDuplicate: (picked) =>
      void run(() => duplicateTopics(source, projectId, picked), 'Could not duplicate.'),
    onRemove: (picked) =>
      void run(async () => {
        await removeTopics(source, projectId, picked)
        if (picked.some((line) => line.id === view.row)) update({ row: null }, true)
      }, 'Could not delete.'),
    onMergeInto: (picked, into) =>
      void run(() => mergeTopics(source, projectId, picked, into), 'Could not merge.'),
    onCheckNow: (picked) =>
      openDrawer(
        'check-now',
        checkParamsPatch({ scope: { kind: 'topic', ids: picked.map((line) => line.id) } })
      ),
    onMoveToFolder: (picked) =>
      openDrawer('topic-folder', {
        'tf.mode': 'move',
        'tf.topics': picked.map((line) => line.id).join(',')
      })
  }
  const rowMenu = (line: TopicLine): readonly MenuItem[] =>
    topicRowMenu(line, {
      onOpen: openLine,
      onEdit: setEditing,
      onAction,
      actions: gridActions,
      addQuestionsHref: (item) => topicsHashWith(view, { drawer: 'add-questions', target: item.id })
    })
  const folderMenu = (folder: DashFolder): readonly MenuItem[] =>
    folder.id === null
      ? []
      : [
          {
            id: 'rename',
            label: 'Rename folder…',
            icon: 'pencil',
            onSelect: () =>
              openDrawer('topic-folder', { 'tf.mode': 'rename', 'tf.folder': folder.id ?? '' })
          },
          {
            id: 'delete',
            label: 'Delete folder…',
            icon: 'trash',
            tone: 'danger',
            onSelect: () =>
              openDrawer('topic-folder', { 'tf.mode': 'delete', 'tf.folder': folder.id ?? '' })
          }
        ]

  const createEmpty = async (name: string): Promise<void> => {
    const created = await source['topics:createEmpty']({ projectId, name })
    notifyTopicsChanged()
    update({ create: false, row: created.topicId }, true)
    showUndo({
      message: created.message,
      undo: async () => {
        await source['topics:update']({ projectId, topicId: created.topicId, status: 'removed' })
        notifyTopicsChanged()
      },
      undoneMessage: `${created.name} is gone.`,
      testId: 'topic-undo'
    })
  }
  const newEmpty = view.create ? (
    <NewEmptyTopic onCreate={createEmpty} onCancel={() => update({ create: false }, true)} />
  ) : null

  const newTopicHref = withShellDialog(topicsViewHash(view), 'new-topic')
  // ✦ Help me find them: New topic open on "A buyer problem", its helper way.
  const newTopicHelpHref = withDrawerOpened(topicsViewHash(view), 'new-topic', { way: 'problem' })
  /** Opens Suggest topics and asks Claude, unless ideas were already asked for. */
  const openSuggest = (): void => {
    update({ suggest: true })
    if (suggest.phase === 'idle') suggest.ask(false)
  }
  const header = (
    <ScreenHeader
      title="Topics"
      subtitle={
        board && board.topics.length > 0 ? (
          <p className="tl-lead num">
            {pluralize(board.topics.length, 'topic')}
            {data && data.folders.length > 0
              ? ` in ${pluralize(data.folders.length, 'folder')}`
              : ''}{' '}
            · {pluralize(board.totals.searches, 'search', 'searches')}
          </p>
        ) : (
          <p className="tl-lead">
            Buyer questions you want cited for. Aim for {bandText(DEFAULT_QUESTION_BAND)}.
          </p>
        )
      }
      primary={{ label: 'New topic', icon: 'plus', href: newTopicHref, guide: 'topics-new' }}
      more={[
        {
          id: 'suggest',
          label: 'Suggest topics',
          icon: 'sparkle',
          onSelect: openSuggest,
          disabled: view.suggest
        },
        {
          id: 'new-empty',
          label: 'New empty topic',
          icon: 'plus',
          onSelect: () => update({ create: true }),
          disabled: view.create
        },
        {
          id: 'new-folder',
          label: 'New folder',
          icon: 'folder',
          onSelect: () => openDrawer('topic-folder', { 'tf.mode': 'create' })
        }
      ]}
    />
  )

  if (data === null) {
    return (
      <div className="page-stack tl-screen">
        {header}
        {state.status === 'error' ? (
          <div role="alert">
            <EmptyState
              icon="warning"
              title="Could not load the topics"
              body={state.message}
              action={
                <Button size="sm" onClick={reload}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : (
          <p className="faint" role="status">
            Loading topics…
          </p>
        )}
      </div>
    )
  }

  const shownRows = inFolder(rows, folderFilter)
  const folderName =
    folderFilter === null
      ? null
      : (board?.folders.find((item) => folderKey(item) === folderFilter)?.name ??
        (folderFilter === 'none' ? NO_FOLDER : null))
  const folderOf = new Map(rows.map((row) => [row.id, row.folder.name]))
  const tfMode = folderDrawer?.entry.params['tf.mode']
  const tfTopics = (folderDrawer?.entry.params['tf.topics'] ?? '').split(',').filter(Boolean)
  const actionLine =
    view.action !== null ? (lines.find((line) => line.id === view.topic) ?? null) : null
  const suggestSection = view.suggest ? (
    <SuggestTopics domain={domain} suggest={suggest} onClose={() => update({ suggest: false })} />
  ) : null

  return (
    <ResultWordsProvider engine={engine}>
      <DrillHost>
        <div className="page-stack tl-screen" aria-busy={state.status === 'loading' || undefined}>
          {header}
          {notice ? (
            <p className={`tl-notice tl-notice-${notice.tone}`} role="status">
              <span>{notice.message}</span>
              {notice.undo !== undefined ? (
                <UndoButton topic={notice.undo} onUndo={(topic) => void undo(topic)} />
              ) : null}
              <IconButton icon="x" label="Dismiss" tip size="sm" onClick={() => setNotice(null)} />
            </p>
          ) : null}
          {lines.length === 0 ? (
            <>
              {newEmpty}
              <EmptyState
                icon="layers"
                title="No topics yet"
                body="Start from a buyer problem, a page or your questions."
                action={
                  <div className="tl-empty-actions">
                    <HelpFillPair
                      primary={{ label: 'New topic', href: newTopicHref }}
                      help={{ label: 'Help me find them', href: newTopicHelpHref }}
                    />
                    <Button size="sm" variant="text" onClick={openSuggest}>
                      Suggest topics
                    </Button>
                  </div>
                }
              />
              {suggestSection}
            </>
          ) : (
            <>
              {board ? (
                <DashKpis
                  kpis={board.kpis}
                  topics={board.topics}
                  allPageFixes={allFixes}
                  rows={kpiRows}
                  sources={sources}
                  marketId={marketId}
                  pageFixes={topicFixes}
                  engine={engine}
                />
              ) : null}
              <ViewTabs<DashView>
                label="Topics views"
                panelId={PANEL_ID}
                views={DASH_VIEWS}
                value={screen.view}
                onChange={screen.setView}
                hrefFor={screen.hrefFor}
              />
              {folderFilter !== null ? (
                <div className="ui-drill-filters">
                  <span className="ui-fchip">
                    Folder: {folderName ?? 'not available to you'}
                    <button
                      type="button"
                      className="ui-fchip-remove"
                      aria-label={`Remove filter Folder: ${folderName ?? ''}`}
                      onClick={() => setQuery({ folder: null })}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ) : null}
              <TabPanel panelId={PANEL_ID} id={screen.view}>
                {screen.view === 'tree' && board ? (
                  <DashTree
                    rows={shownRows}
                    folders={board.folders}
                    editing={editing}
                    onEdit={setEditing}
                    onOpen={openLine}
                    onRename={gridActions.onRename}
                    menu={rowMenu}
                    folderMenu={folderMenu}
                    current={view.row}
                    engine={engineFilter.slot}
                    engineValue={engine}
                  />
                ) : screen.view === 'grid' && board ? (
                  <DashGrid board={board} engine={engineFilter.slot} engineValue={engine} />
                ) : (
                  <TopicsGrid
                    lines={shownRows.map((row) => row.line)}
                    sources={sources}
                    marketId={marketId}
                    current={view.row}
                    addQuestionsHref={(line) =>
                      topicsHashWith(view, { drawer: 'add-questions', target: line.id })
                    }
                    onOpen={openLine}
                    onAction={onAction}
                    editing={editing}
                    onEdit={setEditing}
                    actions={gridActions}
                    busy={busy}
                    folderOf={(line) => folderOf.get(line.id) ?? NO_FOLDER}
                    engine={engineFilter.slot}
                  />
                )}
              </TabPanel>
              {/* New empty topic (header ⋯) opens here, under the grid. */}
              {newEmpty}
              {suggestSection}
            </>
          )}
          {(view.action === 'merge' || view.action === 'split') && actionLine !== null ? (
            <TopicActionDrawer
              key={`${view.action}:${actionLine.id}`}
              action={view.action}
              line={actionLine}
              lines={lines}
              projectId={projectId}
              source={source}
              onClose={closeAction}
              onDone={onDone}
              // The drawer's entry becomes the New empty topic form's, so Back skips neither.
              onNewTopic={() => update({ action: null, topic: null, create: true }, true)}
            />
          ) : null}
          {folderDrawer && isFolderMode(tfMode) ? (
            <DrawerLevel depth={folderDrawer.depth}>
              <FolderDrawer
                key={`${tfMode}:${folderDrawer.entry.params['tf.folder'] ?? ''}:${tfTopics.join(',')}`}
                mode={tfMode}
                projectId={projectId}
                folders={data.folders}
                folderId={folderDrawer.entry.params['tf.folder'] ?? null}
                topicIds={tfTopics}
                topicName={
                  tfTopics.length === 1
                    ? (lines.find((line) => line.id === tfTopics[0])?.name ?? null)
                    : null
                }
                source={source}
                onClose={() => folderDrawer.close()}
              />
            </DrawerLevel>
          ) : null}
          {view.action === 'delete' && actionLine !== null ? (
            <TopicDeleteConfirm
              key={actionLine.id}
              line={actionLine}
              projectId={projectId}
              source={source}
              onClose={closeAction}
              onDone={onDone}
            />
          ) : null}
          {view.action !== null &&
          view.action !== 'rename' &&
          actionLine === null &&
          state.status === 'ready' ? (
            <p className="tl-notice tl-notice-bad" role="alert">
              That topic is not available to you.{' '}
              <Button size="sm" variant="text" onClick={closeAction}>
                Close
              </Button>
            </p>
          ) : null}
        </div>
      </DrillHost>
    </ResultWordsProvider>
  )
}

function UndoButton({
  topic,
  onUndo
}: {
  topic: { id: string; name: string }
  onUndo: (topic: { id: string; name: string }) => void
}): JSX.Element {
  return (
    <Button size="sm" variant="text" onClick={() => onUndo(topic)}>
      Undo
    </Button>
  )
}
