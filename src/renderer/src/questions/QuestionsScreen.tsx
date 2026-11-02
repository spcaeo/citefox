import { useCallback, useMemo, useRef, useState, type JSX } from 'react'
import type { TopicBand } from '@shared/domain'
import { questionsAndKeywords } from '@shared/pluralize'
import type { QuestionRow, QuestionSource } from '@shared/ipc'
import { useAiContext } from '../assistant/context/useAiContext'
import { errorText } from '../components/errorText'
import { ScreenHeader } from '../components/Header'
import { LiveCheckLine } from '../components/LiveCheckLine'
import { DrillHost, DrillNumber } from '../drill'
import { EngineLegend } from '../engines/EngineDots'
import { useEngineFilter } from '../engines/useEngineFilter'
import { ENGINE_TAB_PARAM, isAnswerFilter, type EngineFilter } from '../engines/model'
import { useEngineSummary } from '../engines/useEngineSummary'
import {
  copyQuestionText,
  moveQuestions,
  openMoveQuestions,
  openQuestionEditor,
  questionEditSource,
  restoreUndo,
  setStage,
  updateQuestions,
  type MoveItem,
  type QuestionEditSource
} from '../questionEdit'
import { DrawerLevel } from '../shell/DrawerLevel'
import { useDrawerEntry } from '../shell/drawers'
import { navigateHash, promptHash, replaceHash } from '../shell/routes'
import { inTopic } from '../topics/clusters'
import { BriefDrawer } from '../topics/views/components/BriefDrawer'
import { SearchesDrawer } from '../topics/views/components/SearchesDrawer'
import { rowsOnEngine, type Search } from '../topics/views/model'
import { patchHashQuery, useHashQuery } from '../utils/hashQuery'
import {
  Button,
  EmptyState,
  HelpFillPair,
  KpiStrip,
  KpiTile,
  ResultWordsProvider,
  showUndo,
  type ScreenViewStore
} from '../ui'
import { EngineKpis } from './components/EngineKpis'
import { QuestionGroupControls } from './components/QuestionFilters'
import { questionFilterGroups, questionMarketGroup } from './filterGroups'
import { QuestionsGrid, type QuestionRowActions } from './components/QuestionsGrid'
import { RecheckPicked } from './components/RecheckPicked'
import { SortDrawer } from './components/SortDrawer'
import { TargetDrawer } from './components/TargetDrawer'
import { groupCount, topicChoices } from './grouping'
import { useClusterActions } from './hooks/useClusterActions'
import { useQuestionActions } from './hooks/useQuestionActions'
import { useQuestionFolders } from './hooks/useQuestionFolders'
import { useQuestions } from './hooks/useQuestions'
import { questionsHash, useQuestionsUrl, withParams } from './hooks/useQuestionsUrl'
import { useTopics } from './hooks/useTopics'
import { DEFAULT_VIEW, countText, filterRows, questionKpis, type QuestionsView } from './model'
import { questionsKpiDrill } from './drills'
import { createQuestionsSource, type QuestionsSource } from './source'
import { folderName, folderSourceIds, inFolderRows } from './views/folder'
import { QuestionsViews } from './views/QuestionsViews'
import { useQuestionsEnv } from './views/useQuestionsEnv'
import './questions.css'

/** The shared question actions, with the screen's own channels where it has them. */
function editSourceOf(source: QuestionsSource): QuestionEditSource {
  return {
    ...questionEditSource(),
    'questions:list': (request) => source['questions:list'](request),
    'questions:update': (request) => source['questions:update'](request),
    'topics:moveQuestions': (request) => source['topics:moveQuestions'](request),
    'topics:setQuestionStage': (request) => source['topics:setQuestionStage'](request),
    'checks:start': (request) => source['checks:start'](request)
  }
}

const NO_SOURCES: readonly QuestionSource[] = []
const FOLDER_KEYS = ['folder'] as const

const SUBTITLE = 'Every question and keyword you track.'

/**
 * Questions: every tracked question of every page and topic in the project, in the
 * topic's four views (Tree · Grid · List · Pages) with the latest check in one market.
 * The List groups by topic (default), stage or target page. Ticked questions move
 * between topics, get a stage or a target page, or start a new topic; "Not in a topic"
 * can be sorted by Claude. A count in Tree, Grid or Pages opens its drill page
 * (`d.result=not_cited`). The view, filters (`folder=` too), sort, grouping, search, the
 * open drawer or confirm and the marked row live in the URL (`#/questions?…`). A row
 * opens the prompt detail.
 */
interface ScreenProps {
  projectId: string
  /** Tests pass a fake. Production uses the preload bridge. */
  source?: QuestionsSource
  /** Tests only: where the picked view is remembered (null keeps nothing). */
  viewStore?: ScreenViewStore | null
}

/** The Questions screen; its KPI numbers open their questions in the drill drawer. */
export function QuestionsScreen(props: ScreenProps): JSX.Element {
  return (
    <DrillHost>
      <QuestionsBody {...props} />
    </DrillHost>
  )
}

function QuestionsBody({ projectId, source: given, viewStore }: ScreenProps): JSX.Element {
  const source = useMemo(() => given ?? createQuestionsSource(), [given])
  const edit = useMemo(() => editSourceOf(source), [source])
  const [inline, setInline] = useState<string | null>(null)
  const url = useQuestionsUrl()
  const { view, update, openOverlay, closeOverlay } = url
  const { state, reload } = useQuestions(source, projectId, view.market)
  const actions = useQuestionActions(source, projectId, reload)
  const list = state.data
  const topicList = useTopics(source, projectId, list)
  const pageIds = useMemo(() => (list ? list.sources.map((item) => item.id) : null), [list])
  const engineSummary = useEngineSummary(list ? source['engines:summary'] : undefined, projectId, {
    pageIds,
    marketId: list?.marketId ?? null,
    reload: list
  })
  const offered = useMemo(
    () => (engineSummary.engines.length >= 2 ? engineSummary.engines : []),
    [engineSummary.engines]
  )
  // The engine filter (`?engine=chatgpt`) in every view's toolbar spot (audit2 #8): All plus
  // each engine with two or more, else the one engine named; a dot per engine on the List.
  const engineFilter = useEngineFilter(engineSummary.engines)
  const engine: EngineFilter = engineFilter.engine
  // The Topics dashboard's folder links (`?folder=<id>` or `none`) narrow every view.
  const [{ folder: folderKey }, setFolderQuery] = useHashQuery(FOLDER_KEYS)
  const folders = useQuestionFolders(source, projectId)
  const inFolder = useMemo(
    () => (list ? inFolderRows(list.rows, folderSourceIds(folders, folderKey, list.sources)) : []),
    [list, folders, folderKey]
  )

  const sources = useMemo(
    () => new Map<string, QuestionSource>((list?.sources ?? []).map((item) => [item.id, item])),
    [list]
  )
  // Result and Change filter Google AI Overview's results; another engine's view ignores them.
  const answerView = isAnswerFilter(engine)
  const rows = useMemo(
    () =>
      list
        ? filterRows(inFolder, sources, answerView ? { ...view, result: null, change: null } : view)
        : [],
    [list, inFolder, sources, view, answerView]
  )
  const cluster = useClusterActions(source, projectId, sources, actions.perform)
  const topics = useMemo(() => (list ? topicChoices(list, topicList) : []), [list, topicList])
  const bands = useMemo(
    () => new Map<string, TopicBand>(topicList.map((topic) => [topic.id, topic.bands.questions])),
    [topicList]
  )
  /** Clears the ticks behind the open target panel once it sets the page. */
  const clearPicked = useRef<() => void>(() => undefined)
  const marketLabel =
    list?.markets.find((market) => market.id === list.marketId)?.label ?? 'the default market'
  const shownFolder = folderName(folders, folderKey)
  useAiContext({
    entities: list?.marketId ? [{ kind: 'market', id: list.marketId, label: marketLabel }] : [],
    selection: (list?.rows ?? [])
      .filter((row) => view.pick.includes(row.promptId))
      .map((row) => ({ kind: 'question', id: row.promptId, label: row.text })),
    filters: {
      ...questionFilters(view, sources, url.search),
      ...(folderKey !== null ? { folder: shownFolder ?? folderKey } : {})
    }
  })

  const openRow = useCallback(
    (row: QuestionRow) => {
      replaceHash(questionsHash({ ...view, q: url.search, row: row.promptId }))
      // The prompt as it was checked: a moved question opens where its result lives.
      const promptId = row.resultPromptId ?? row.promptId
      const hash = promptHash(row.resultPageId ?? row.sourceId, promptId, {
        marketId: list?.marketId ?? null,
        runId: row.runId
      })
      // One answer engine picked: the question opens on that engine's tab.
      navigateHash(
        isAnswerFilter(engine) ? patchHashQuery(hash, { [ENGINE_TAB_PARAM]: engine }) : hash
      )
    },
    [view, url.search, list?.marketId, engine]
  )

  // Choose owner in a view or drill: the target panel for those searches.
  const chooseOwner = useCallback(
    (searches: readonly Search[]) =>
      openOverlay({ panel: 'target', confirm: null, pick: searches.map((search) => search.id) }),
    [openOverlay]
  )
  // Tree, Grid, Pages and the drill pages re-count on the picked engine, as Topics does.
  const engineRows = useMemo(
    () => rowsOnEngine(inFolder, engine, engineSummary.questions, list?.marketId ?? null),
    [inFolder, engine, engineSummary.questions, list?.marketId]
  )
  const { env, query } = useQuestionsEnv(engineRows, list?.sources ?? NO_SOURCES, {
    site: list?.lens.ownDomain || null,
    openRow,
    chooseOwner,
    engine,
    engineSlot: engineFilter.slot
  })
  const briefDrawer = useDrawerEntry('topic-brief')

  // The re-check confirm is on the URL (`confirm=recheck&pick=<ids>`); Remove acts at once with Undo.
  const askRecheck = useCallback(
    (selected: readonly QuestionRow[]) =>
      openOverlay({
        panel: null,
        confirm: 'recheck',
        pick: selected.map((row) => row.promptId)
      }),
    [openOverlay]
  )

  const closePanel = closeOverlay
  const here = { ...view, q: url.search }

  const moveItems = (rows: readonly QuestionRow[]): MoveItem[] =>
    rows.map((row) => ({
      sourceId: row.sourceId,
      promptId: row.promptId,
      fromTopicId: sources.get(row.sourceId)?.kind === 'topic' ? row.sourceId : null
    }))

  const saveInline = async (row: QuestionRow, text: string): Promise<void> => {
    const marketId =
      row.inMarket && list?.marketId
        ? list.marketId
        : (sources.get(row.sourceId)?.marketIds[0] ?? null)
    if (marketId === null) return
    try {
      const result = await edit['questions:edit']({
        projectId,
        sourceId: row.sourceId,
        promptId: row.promptId,
        texts: [{ marketId, text }]
      })
      setInline(null)
      const undo = result.restore ? restoreUndo(edit, projectId, [result.restore]) : undefined
      showUndo({
        message: result.changed ? 'Saved the new wording as a new version.' : result.message,
        effect: result.changed ? 'Earlier results stay with the old wording.' : null,
        ...(undo ? { undo } : {})
      })
      reload()
    } catch (cause) {
      showUndo({ message: errorText(cause, 'Could not save the wording.', { sentence: true }) })
    }
  }

  const rowActions: QuestionRowActions = {
    onOpen: openRow,
    onEdit: (row) => openQuestionEditor({ sourceId: row.sourceId, promptId: row.promptId }),
    onRecheckOne: (row) => askRecheck([row]),
    onToggle: (row) =>
      void updateQuestions(edit, projectId, row.enabled ? 'disable' : 'enable', [row]),
    onEditInline: (row) => setInline(row.promptId),
    onInlineSave: (row, text) => void saveInline(row, text),
    onInlineCancel: () => setInline(null),
    onCopyText: (row) => void copyQuestionText(row.text),
    onMoveOne: (row, mode) =>
      openMoveQuestions([{ sourceId: row.sourceId, promptId: row.promptId }], mode),
    onStageOne: (row, stage) =>
      void setStage(edit, projectId, [{ ...row, previous: row.stage }], stage),
    onRemoveOne: (row) => void updateQuestions(edit, projectId, 'remove', [row]),
    onMoveMany: (selected, mode, clear) => {
      clear()
      openMoveQuestions(
        selected.map((row) => ({ sourceId: row.sourceId, promptId: row.promptId })),
        mode
      )
    },
    onRecheck: (selected) => askRecheck(selected),
    onSetEnabled: (selected, enabled, clear) => {
      clear()
      void updateQuestions(
        edit,
        projectId,
        enabled ? 'enable' : 'disable',
        selected.filter((row) => row.enabled !== enabled)
      )
    },
    onRemove: (selected, clear) => {
      clear()
      void updateQuestions(edit, projectId, 'remove', selected)
    },
    onMove: (selected, to, clear) => {
      clear()
      void moveQuestions(edit, projectId, moveItems(selected), to)
    },
    onNewTopic: (selected) =>
      navigateHash(
        withParams(here, {
          drawer: 'new-topic',
          questions: selected.map((row) => row.promptId).join(',')
        })
      ),
    onSetStage: (selected, stage, clear) => {
      clear()
      void setStage(
        edit,
        projectId,
        selected.map((row) => ({ ...row, previous: row.stage })),
        stage
      )
    },
    onTarget: (selected, clear) => {
      clearPicked.current = clear
      openOverlay({
        panel: 'target',
        confirm: null,
        pick: selected.map((row) => row.promptId)
      })
    },
    onSort: () => openOverlay({ panel: 'sort', confirm: null, pick: [] }),
    addHref: (topicId) => withParams(here, { drawer: 'add-questions', target: topicId }),
    onDropMove: (refs, to) => {
      const rows = refs.flatMap(
        (ref) => list?.rows.find((row) => row.promptId === ref.promptId) ?? []
      )
      void moveQuestions(edit, projectId, moveItems(rows), to)
    }
  }

  const addParams: Record<string, string> =
    view.source !== null
      ? { drawer: 'add-questions', target: view.source }
      : { drawer: 'add-questions' }
  const addHref = withParams({ ...view, q: url.search }, addParams)
  // ✦ Help me write them: Add questions open on its helper tab.
  const helpHref = withParams({ ...view, q: url.search }, { ...addParams, tab: 'suggest' })
  const header = (
    <ScreenHeader
      title="Questions"
      subtitle={<p className="qs-subtitle faint">{SUBTITLE}</p>}
      primary={{ label: 'Add questions', icon: 'plus', href: addHref, guide: 'questions-add' }}
      more={[
        {
          id: 'import',
          label: 'Import from Excel or CSV',
          icon: 'upload',
          href: withParams({ ...view, q: url.search }, { ...addParams, tab: 'import' })
        }
      ]}
    />
  )

  if (list === null) {
    return (
      <div className="page-stack qs-screen">
        {header}
        {state.status === 'error' ? (
          <div role="alert">
            <EmptyState
              icon="warning"
              title="Could not load the questions"
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
            Loading questions…
          </p>
        )}
      </div>
    )
  }

  const kpis = questionKpis(list.rows)
  const drills = {
    tracked: questionsKpiDrill('tracked', list, sources, marketLabel),
    off: questionsKpiDrill('off', list, sources, marketLabel),
    overviews: questionsKpiDrill('overviews', list, sources, marketLabel),
    cited: questionsKpiDrill('cited', list, sources, marketLabel),
    named: questionsKpiDrill('named', list, sources, marketLabel)
  }
  const groups = groupCount(rows, view.group, sources)
  const rowKeywords = rows.filter((row) => row.promptKind === 'keyword').length
  const rowCount = questionsAndKeywords(rows.length - rowKeywords, rowKeywords)
  const countLine = view.group === 'none' ? rowCount : `${rowCount} · ${countText(groups, 'group')}`
  // The link shows "N off"; its name starts with those words (WCAG 2.5.3), then says what.
  const offCount = list.rows.length - kpis.tracked
  const off = `${offCount.toLocaleString('en-US')} off: ${countText(offCount, 'question')} not tracked`
  const unsorted = rows.filter((row) => !inTopic(row, sources))
  // Picked anywhere: the List's ticks, or a view's or drill's Choose owner.
  const picked = list.rows.filter((row) => view.pick.includes(row.promptId))
  const clearFilters = (): void => {
    url.setSearch('')
    update({ ...DEFAULT_VIEW, market: view.market, group: view.group, sort: view.sort })
  }
  const empty =
    list.rows.length === 0 ? (
      <EmptyState
        icon="inbox"
        title="No questions yet"
        body="Add the questions buyers ask, and CiteFox checks each one in Google."
        action={
          <HelpFillPair
            primary={{ label: 'Add questions', href: addHref }}
            help={{ label: 'Help me write them', href: helpHref }}
          />
        }
      />
    ) : (
      <EmptyState
        icon="search"
        title="No questions match these filters"
        action={
          <Button size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    )

  const trackedTile = (
    <KpiTile
      label="Tracked"
      value={<DrillNumber drill={drills.tracked} headline="questions-tracked" />}
      // Only the questions left out of checks, when there are any: the rest is the number.
      sub={offCount > 0 ? <DrillNumber drill={drills.off} suffix=" off" label={off} /> : undefined}
    />
  )

  // The newest whole check, for "Checked just now" when a check ends.
  const lastChecked =
    list.rows
      .flatMap((row) => (row.checkedAt !== null && !row.partialCheck ? [row.checkedAt] : []))
      .sort()
      .at(-1) ?? null

  const folderChip =
    folderKey !== null ? (
      <div className="ui-drill-filters">
        <span className="ui-fchip">
          Folder: {shownFolder ?? 'not available to you'}
          <button
            type="button"
            className="ui-fchip-remove"
            aria-label={`Remove filter Folder: ${shownFolder ?? ''}`}
            onClick={() => setFolderQuery({ folder: null })}
          >
            ✕
          </button>
        </span>
      </div>
    ) : null
  const listView = (
    <>
      <QuestionsGrid
        list={list}
        rows={rows}
        sources={sources}
        view={view}
        search={url.search}
        onSearch={url.setSearch}
        onSort={(sort) => update({ sort })}
        busy={actions.busy}
        topics={topics}
        bands={bands}
        actions={rowActions}
        inline={inline}
        empty={empty}
        engines={offered}
        engine={engine}
        engineSlot={engineFilter.slot}
        statuses={engineSummary.statuses}
        filters={questionFilterGroups(list, view, (patch) => update(patch), !answerView)}
        filterControls={[questionMarketGroup(list, (patch) => update(patch))].filter(
          (group) => group !== null
        )}
        toolbar={<QuestionGroupControls view={view} onChange={(patch) => update(patch)} />}
        summary={(info) =>
          info.last - info.first + 1 < info.matching
            ? `${info.first.toLocaleString('en-US')}–${info.last.toLocaleString('en-US')} of ${info.matching.toLocaleString('en-US')}`
            : countLine
        }
      />
      {offered.length > 0 && engine !== 'google_aio' && rows.length > 0 ? <EngineLegend /> : null}
    </>
  )
  const briefIds = new Set((briefDrawer?.entry.params['tb.ids'] ?? '').split(','))
  const briefSearches = env.searches.filter((search) => briefIds.has(search.id))
  const briefTargets = new Set(briefSearches.map((search) => search.targetUrl))

  return (
    <ResultWordsProvider engine={engine}>
      <div className="page-stack qs-screen">
        {header}
        <LiveCheckLine live={list.live} checkedAt={lastChecked} />
        {isAnswerFilter(engine) ? (
          <EngineKpis
            engine={engine}
            tracked={trackedTile}
            list={list}
            sources={sources}
            statuses={engineSummary.statuses}
            marketLabel={marketLabel}
          />
        ) : (
          <KpiStrip label="Questions summary">
            {trackedTile}
            <KpiTile
              label="AI Overview shows"
              value={<DrillNumber drill={drills.overviews} headline="questions-overviews" />}
            />
            <KpiTile
              label="Cited"
              value={<DrillNumber drill={drills.cited} headline="questions-cited" />}
            />
            <KpiTile
              label="Named"
              value={<DrillNumber drill={drills.named} headline="questions-named" />}
            />
          </KpiStrip>
        )}
        {actions.message || state.status === 'error' ? (
          <p className="qs-message" role="status">
            {state.status === 'error' ? state.message : actions.message}
          </p>
        ) : null}
        {list.rows.length === 0 ? (
          listView
        ) : (
          <>
            {folderChip}
            <QuestionsViews
              env={env}
              projectId={projectId}
              list={listView}
              {...(viewStore !== undefined ? { viewStore } : {})}
            />
          </>
        )}
        {query.isDrill && query.drillDrawer ? (
          <DrawerLevel depth={query.drillDrawer.depth}>
            <SearchesDrawer
              env={env}
              filter={query.drill}
              where={`${shownFolder ? ` in ${shownFolder}` : ''} · ${marketLabel}`}
              sourceName={(id) => sources.get(id)?.name ?? id}
              listName={shownFolder ?? 'Questions'}
              onClose={() => query.drillDrawer?.close()}
            />
          </DrawerLevel>
        ) : null}
        {briefDrawer ? (
          <DrawerLevel depth={briefDrawer.depth}>
            <BriefDrawer
              searches={briefSearches}
              title={briefDrawer.entry.params['tb.title'] ?? 'Searches on Questions'}
              topicName={shownFolder ?? 'Every topic and page'}
              marketName={marketLabel}
              targetUrl={briefTargets.size === 1 ? ([...briefTargets][0] ?? null) : null}
              perSearchTarget={briefTargets.size > 1}
              onClose={() => briefDrawer.close()}
            />
          </DrawerLevel>
        ) : null}
        {view.panel === 'sort' ? (
          <SortDrawer
            rows={unsorted}
            topics={topics}
            source={source}
            projectId={projectId}
            busy={actions.busy}
            onClose={closePanel}
            onApply={(batches) => {
              void cluster.move(batches).then(closePanel)
            }}
          />
        ) : null}
        {view.panel === 'target' ? (
          <TargetDrawer
            rows={picked}
            sources={sources}
            source={source}
            projectId={projectId}
            busy={actions.busy}
            onClose={closePanel}
            onApply={(target) => {
              void cluster.setTarget(picked, target).then((changed) => {
                if (changed) clearPicked.current()
                closePanel()
              })
            }}
          />
        ) : null}
        {view.confirm === 'recheck' ? (
          <RecheckPicked
            rows={list.rows.filter((row) => view.pick.includes(row.promptId))}
            sources={sources}
            marketLabel={marketLabel}
            searchesLeft={actions.searchesLeft}
            onCancel={closePanel}
            onConfirm={(plan) => {
              closePanel()
              if (list.marketId !== null) void actions.recheck(plan, list.marketId, marketLabel)
            }}
          />
        ) : null}
      </div>
    </ResultWordsProvider>
  )
}

/** The filters the screen shows, named for Ask CiteFox. */
function questionFilters(
  view: QuestionsView,
  sources: ReadonlyMap<string, QuestionSource>,
  search: string
): Record<string, string> {
  const out: Record<string, string> = { group: view.group }
  if (view.kind !== null) out.kind = view.kind
  if (view.type !== null) out.type = view.type
  if (view.source !== null) out.source = sources.get(view.source)?.name ?? view.source
  if (view.result !== null) out.result = view.result
  if (view.change !== null) out.change = view.change
  if (search !== '') out.search = search
  return out
}
