import { useCallback, useEffect, useMemo, type JSX } from 'react'
import { SEARCHES_PER_PROMPT_MAX } from '@shared/domain'
import { useAiContext } from '../../assistant/context/useAiContext'
import { useBuildTools } from '../../buildMenu/buildClient'
import { runCheck } from '../../checkNow/run'
import { createCheckNowSource } from '../../checkNow/source'
import { LiveCheckLine } from '../../components/LiveCheckLine'
import { LoadError } from '../../components/LoadError'
import { EngineFilterBar, EngineFixed } from '../../engines/EngineDots'
import { isAnswerFilter } from '../../engines/model'
import { useEngineFilter } from '../../engines/useEngineFilter'
import { useEngineSummary } from '../../engines/useEngineSummary'
import { currentClientMode } from '../../onboarding/flags'
import { openMoveQuestions, questionEditSource, resolveQuestions } from '../../questionEdit'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { withDrawerOpened } from '../../shell/drawerUrl'
import { navigateHash, replaceHash, topicHash } from '../../shell/routes'
import { patchHashQuery } from '../../utils/hashQuery'
import {
  AiMenu,
  EmptyState,
  LinkButton,
  ResultWordsProvider,
  resultWords,
  showUndo,
  type ScreenViewStore
} from '../../ui'
import { notifyTopicsChanged } from '../clusters/events'
import { addQuestionsToTopicHash } from '../settings/model'
import { BriefDrawer } from '../views/components/BriefDrawer'
import { SearchesDrawer } from '../views/components/SearchesDrawer'
import type { Search } from '../views/model'
import { useTopicEnv } from '../views/hooks/useTopicEnv'
import { TopicViews } from '../views/TopicViews'
import { legacyTopicPatch, withoutDrillDrawer } from '../views/url'
import { BandsDrawer } from './components/BandsDrawer'
import { ChangeTargetDrawer } from './components/ChangeTargetDrawer'
import { ProgressTab } from './components/ProgressTab'
import { TopicHeader } from './components/TopicHeader'
import { TopicPageDrawer } from './components/TopicPageDrawer'
import { topicViewsAiActions } from './components/topicAi'
import type { ResultsTab } from './constants'
import { checkingRows, runningRefs, showRow, useCheckInFlight } from './hooks/useCheckInFlight'
import { useTopicCall } from './hooks/useTopicCall'
import { useTopicResults } from './hooks/useTopicResults'
import { TopicPageMatch } from './components/TopicPageMatch'
import { topicDrills } from './model/drills'
import { formatCheckTime } from './model/format'
import { rowsById } from './model/scoring'
import { topicResultsSource, type TopicResultsSource } from './source'
import './results.css'
import '../views/topicViews.css'

/**
 * Topic results (TopicBig.png): breadcrumb and header, the summary card with the big
 * result bar, and one row of views (Tree · Grid · List · Pages | Progress). Every count
 * opens the searches behind it in a drawer over the view (TopicBigDrill.png,
 * `drawer=search-drill&stage=…&result=…`), and a quiet first check shows the calm card. URLs from before the views
 * (`tab=todo|stage|keywords`, `filter=state:…`) are rewritten in place.
 */
export function TopicResultsScreen({
  projectId,
  projectName,
  topicId,
  marketId = null,
  runId = null,
  filter = null,
  source,
  viewStore
}: {
  projectId: string
  projectName: string
  topicId: string
  /** The route's tab from before the views; the URL itself is rewritten. */
  tab?: ResultsTab
  marketId?: string | null
  /** A check pinned by the route; null is the latest results. */
  runId?: string | null
  /** `target:<promptId>` opens Change target page; older drill filters are rewritten. */
  filter?: string | null
  /** Tests only. */
  source?: TopicResultsSource
  /** Tests only: where the picked view is remembered (null keeps nothing). */
  viewStore?: ScreenViewStore | null
}): JSX.Element {
  const resultsSource = useMemo(() => source ?? topicResultsSource(currentClientMode()), [source])
  // The engine filter (`?engine=chatgpt`): the engines this topic has answers from. Picking
  // one re-reads the topic from that engine's answers, so every view and Progress re-count.
  const summaryChannel = useMemo(
    () =>
      resultsSource.engineSummary ? resultsSource.engineSummary.bind(resultsSource) : undefined,
    [resultsSource]
  )
  const topicPages = useMemo(() => [topicId], [topicId])
  const engineSummary = useEngineSummary(summaryChannel, projectId, {
    pageIds: topicPages,
    marketId
  })
  const engineFilter = useEngineFilter(engineSummary.engines)
  const state = useTopicResults({
    projectId,
    topicId,
    marketId,
    runId,
    source: resultsSource,
    engine: isAnswerFilter(engineFilter.engine) ? engineFilter.engine : null
  })
  const { results } = state
  // Target bands, Change target page and the fix brief are drawers on the URL, so Back
  // closes them and a link reopens them.
  const bandsDrawer = useDrawerEntry('topic-bands')
  const targetDrawer = useDrawerEntry('topic-target')
  const pageDrawer = useDrawerEntry('topic-page')
  const briefDrawer = useDrawerEntry('topic-brief')
  // A drill's "Change target page" link (`filter=target:<promptId>`) becomes the drawer's URL.
  const targetFocus = filter?.startsWith('target:') ? filter.slice(7) : null
  useEffect(() => {
    if (targetFocus === null) return
    replaceHash(
      withDrawerOpened(patchHashQuery(window.location.hash, { filter: null }), 'topic-target', {
        'tt.ids': targetFocus
      })
    )
  }, [targetFocus])
  // Old links (`tab=todo`, `filter=state:not_cited`) land on the matching view or drill.
  useEffect(() => {
    const hash = window.location.hash
    const patch = legacyTopicPatch(new URLSearchParams(hash.split('?')[1] ?? ''))
    if (patch) replaceHash(patchHashQuery(hash, patch))
  }, [filter])
  const drillWords = useMemo(() => resultWords(engineFilter.engine), [engineFilter.engine])
  const drills = useMemo(
    () => (results ? topicDrills(results, projectId, projectName, drillWords) : null),
    [results, projectId, projectName, drillWords]
  )
  const changeTarget = useCallback(
    (searches: readonly Search[]) =>
      openDrawer('topic-target', { 'tt.ids': searches.map((search) => search.id).join(',') }),
    []
  )
  const meta = results?.topic
  const market = meta?.markets.find((item) => item.id === meta.marketId)
  useAiContext({
    entities: meta
      ? [
          { kind: 'topic', id: meta.id, label: meta.name },
          ...(market ? [{ kind: 'market' as const, id: market.id, label: market.label }] : []),
          ...(meta.checkedAt
            ? [{ kind: 'check' as const, id: runId, label: formatCheckTime(meta.checkedAt) }]
            : [])
        ]
      : []
  })
  const tools = useBuildTools()
  const checkSource = useMemo(() => createCheckNowSource(), [])
  const call = useTopicCall({
    projectId,
    topicId,
    marketId: results?.topic.marketId ?? marketId,
    source: state.source
  })
  // The questions a running check is on now, named in the live line.
  const inFlight = useCheckInFlight({
    source: state.source,
    jobId: results?.live?.state === 'running' ? results.live.jobId : null,
    topicId,
    marketId: results?.topic.marketId ?? null
  })
  const checking = useMemo(
    () => new Map([...checkingRows(inFlight)].map(([id, row]) => [id, row.words])),
    [inFlight]
  )
  const site = results?.topic.domain ?? null
  const answerEngine = isAnswerFilter(engineFilter.engine) ? engineFilter.engine : null
  const envOptions = useMemo(
    () => ({
      site,
      onChangeTarget: changeTarget,
      checking,
      engine: engineFilter.slot,
      answerEngine
    }),
    [site, changeTarget, checking, engineFilter.slot, answerEngine]
  )
  const { env, query } = useTopicEnv(results, envOptions)

  if (!results || !drills) {
    if (state.error) {
      return (
        <LoadError
          title="CiteFox could not load this topic."
          message={state.error}
          onRetry={state.reload}
        />
      )
    }
    return <p role="status">Loading topic…</p>
  }

  const { topic } = results

  const rename = async (name: string): Promise<void> => {
    const before = topic.name
    await state.source.update({ projectId, topicId, name })
    notifyTopicsChanged()
    showUndo({
      message: `Renamed to ${name}.`,
      undo: async () => {
        await state.source.update({ projectId, topicId, name: before })
        notifyTopicsChanged()
      },
      testId: 'topic-undo'
    })
  }

  // Check now starts at once and stays here: the live line and the rows fill in as answers land.
  function checkNow(): void {
    const prompts = topic.questions + topic.keywords
    const markets = topic.markets.length
    runCheck(checkSource, tools.notify, projectId, {
      pageIds: [topicId],
      marketIds: null,
      promptIds: null,
      estimate: {
        min: prompts * markets,
        max: prompts * markets * SEARCHES_PER_PROMPT_MAX,
        pages: 1
      }
    })
  }

  // Move to topic… works on each question's current version (a row may be from an older check).
  async function move(searches: readonly Search[]): Promise<void> {
    const { found, missing } = await resolveQuestions(
      questionEditSource(),
      projectId,
      searches.map((search) => ({ sourceId: topicId, promptId: search.id }))
    )
    if (found.length === 0) {
      showUndo({ message: 'Those searches are no longer tracked.' })
      return
    }
    if (missing > 0) showUndo({ message: `${missing} of them are no longer tracked.` })
    openMoveQuestions(
      found.map((question) => ({ sourceId: question.sourceId, promptId: question.promptId })),
      'move'
    )
  }

  const bands = bandsDrawer ? (
    <DrawerLevel depth={bandsDrawer.depth}>
      <BandsDrawer
        projectId={projectId}
        topicId={topicId}
        bands={topic.bands}
        goals={results.goals}
        source={state.source}
        onClose={() => bandsDrawer.close()}
        onSaved={state.reload}
      />
    </DrawerLevel>
  ) : null

  // The topic's target page (`drawer=topic-page`); it can be set before any question.
  const targetPage = pageDrawer ? (
    <DrawerLevel depth={pageDrawer.depth}>
      <TopicPageDrawer
        projectId={projectId}
        topicId={topicId}
        marketId={topic.marketId}
        current={topic.targetPage}
        domain={topic.domain ?? null}
        source={state.source}
        onClose={() => pageDrawer.close()}
        onSaved={state.reload}
      />
    </DrawerLevel>
  ) : null

  const header = (
    <TopicHeader
      results={results}
      onMarketChange={(next) =>
        replaceHash(patchHashQuery(window.location.hash, { market: next, run: null }))
      }
      onChangeBands={() => openDrawer('topic-bands')}
      onChangeTargetPage={() => openDrawer('topic-page')}
      onCheckNow={checkNow}
      onRename={rename}
    />
  )

  if (topic.questions + topic.keywords === 0) {
    return (
      <ResultWordsProvider engine={engineFilter.engine}>
        <div className="tr" data-topic={topic.id} aria-busy={state.loading || undefined}>
          {header}
          {bands}
          {targetPage}
          <EmptyState
            icon="inbox"
            level={2}
            title="No questions yet"
            body="Add the questions buyers ask. Nothing is checked until this topic has at least one."
            action={
              <LinkButton href={addQuestionsToTopicHash(topic.id)} variant="primary" icon="plus">
                Add questions
              </LinkButton>
            }
          />
        </div>
      </ResultWordsProvider>
    )
  }

  const targetIds = (targetDrawer?.entry.params['tt.ids'] ?? '')
    .split(',')
    .filter((id) => id !== '')
  const targetRows = rowsById(results.rows, targetIds)
  const briefIds = new Set((briefDrawer?.entry.params['tb.ids'] ?? '').split(','))
  const briefSearches = env.searches.filter((search) => briefIds.has(search.id))
  // Each search's own target page (the topic's when it has none of its own).
  const briefTargets = new Set(briefSearches.map((search) => search.targetUrl))
  const checked = topic.checkedAt
    ? `checked ${formatCheckTime(topic.checkedAt)}`
    : 'not checked yet'

  // No target page anywhere yet: any page of the site counts ("Your page cited").
  const wholeSite = topic.targetPage === null && results.rows.every((row) => row.targetUrl === null)

  return (
    <ResultWordsProvider engine={engineFilter.engine} wholeSite={wholeSite}>
      <div className="tr" data-topic={topic.id} aria-busy={state.loading || undefined}>
        {header}
        {runId && topic.checkedAt ? (
          <p className="tr-pinned" role="status">
            Showing the check of {formatCheckTime(topic.checkedAt)}.{' '}
            <a href={topicHash(topicId, { marketId: topic.marketId })}>Show the latest</a>
          </p>
        ) : null}
        {runId || results.live?.state === 'running' ? null : (
          <TopicPageMatch
            projectId={projectId}
            topicId={topicId}
            marketId={topic.marketId}
            rows={results.rows}
            hasTarget={topic.targetPage !== null}
            source={state.source}
            onSaved={state.reload}
          />
        )}
        {runId ? null : (
          <LiveCheckLine
            live={results.live}
            checkedAt={topic.checkedAt}
            running={runningRefs(inFlight, results.rows)}
            onPick={(promptId) => {
              // Its row in the List, narrowed to its kind so it is on the first page.
              const search = env.searches.find((item) => item.id === promptId)
              if (!search) return
              navigateHash(
                withoutDrillDrawer(
                  patchHashQuery(window.location.hash, {
                    view: 'list',
                    type: search.kind,
                    q: null,
                    p: null,
                    sel: null
                  })
                )
              )
              showRow(promptId)
            }}
          />
        )}
        {state.error ? (
          <p className="tr-note" role="alert">
            {state.error}
          </p>
        ) : null}
        {call.card}
        <TopicViews
          results={results}
          projectId={projectId}
          env={env}
          query={query}
          onMove={(searches) => void move(searches)}
          fileName={topic.name}
          {...(viewStore !== undefined ? { viewStore } : {})}
          ai={
            <AiMenu
              label="AI actions for this topic"
              size="sm"
              actions={topicViewsAiActions(results, call, env.searches)}
            />
          }
          progress={
            <ProgressTab
              projectId={projectId}
              results={results}
              drills={drills}
              call={call}
              engine={
                engineSummary.engines.length >= 2 ? (
                  <EngineFilterBar
                    engines={engineSummary.engines}
                    value={engineFilter.engine}
                    onChange={engineFilter.setEngine}
                  />
                ) : engineSummary.engines[0] ? (
                  <EngineFixed engine={engineSummary.engines[0]} />
                ) : null
              }
              engineValue={engineFilter.engine}
            />
          }
        />
        {query.isDrill && query.drillDrawer ? (
          <DrawerLevel depth={query.drillDrawer.depth}>
            <SearchesDrawer
              env={env}
              filter={query.drill}
              where={` in ${topic.name} · ${checked}`}
              listName={topic.name}
              onClose={() => query.drillDrawer?.close()}
            />
          </DrawerLevel>
        ) : null}
        {targetDrawer ? (
          <DrawerLevel depth={targetDrawer.depth}>
            <ChangeTargetDrawer
              key={targetIds.join(',')}
              projectId={projectId}
              topicId={topicId}
              rows={targetRows}
              source={state.source}
              onClose={() => targetDrawer.close()}
              onSaved={state.reload}
            />
          </DrawerLevel>
        ) : null}
        {briefDrawer ? (
          <DrawerLevel depth={briefDrawer.depth}>
            <BriefDrawer
              searches={briefSearches}
              title={briefDrawer.entry.params['tb.title'] ?? `Searches in ${topic.name}`}
              topicName={topic.name}
              marketName={market?.label ?? ''}
              targetUrl={briefTargets.size === 1 ? ([...briefTargets][0] ?? null) : null}
              perSearchTarget={briefTargets.size > 1}
              onClose={() => briefDrawer.close()}
            />
          </DrawerLevel>
        ) : null}
        {bands}
        {targetPage}
      </div>
    </ResultWordsProvider>
  )
}
