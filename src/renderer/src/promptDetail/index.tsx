import { useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { overviewFromSample } from '@shared/aio-overview'
import type { AssistClient } from '../assist/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { ScreenHeader } from '../components/Header'
import { LoadError } from '../components/LoadError'
import { DrillHost, resultsScope } from '../drill'
import { EngineDot } from '../engines/EngineDots'
import { ENGINE_TAB_PARAM } from '../engines/model'
import { buildResultsDrills } from '../m3/results/drills'
import { formatMonthDay, formatStamp, statusLabel } from '../m3/model'
import { pageLabel } from '../projects/copy'
import { useQuestionItems } from '../questionEdit/useQuestionItems'
import { pageHash, promptHash, runningHash } from '../shell/routes'
import { formatDay } from '../utils/dates'
import { useHashQuery } from '../utils/hashQuery'
import { Button, EmptyState, ToolButton, LinkButton, Panel, TabPanel, Tabs } from '../ui'
import { FixBrief, FixMoreMenu } from './components/FixActions'
import { GoogleSearchCard } from './components/GoogleSearchCard'
import { EngineAnswer } from './components/engines/EngineAnswer'
import {
  engineTabOf,
  engineTabs,
  useQuestionEngines
} from './components/engines/useQuestionEngines'
import { CoverageCard, GapCard, RawDataCard, TimelineCard } from './components/InsightCards'
import { MarketsCard } from './components/MarketsCard'
import { AioCard } from './components/OverviewCards'
import { RemoveCompetitorConfirm } from '../sites/RemoveCompetitorConfirm'
import { SourcesCard } from './components/sources/SourcesCard'
import { OverviewInsightsCard } from './components/insights/OverviewInsightsCard'
import type { ShownRead } from './components/insights/useOverviewRead'
import { usePromptAssists } from './components/PromptAssists'
import { PromptHeader } from './components/PromptHeader'
import { PinToSummary } from '../overview/board/PinToSummary'
import { PromptKpis } from './components/PromptKpis'
import { promptNav } from './components/promptNav'
import {
  isPromptTab,
  PROMPT_TABS_ID,
  PROMPT_VIEW_KEY,
  type PromptTab
} from './components/promptTabs'
import { wordingChange, type PromptPanel } from './edit/model'
import { promptEditParts } from './edit/promptEditParts'
import { PromptMoreMenu } from './edit/PromptMoreMenu'
import { RecheckStatus } from './edit/RecheckStatus'
import { QuestionTarget } from './components/QuestionTarget'
import { createPromptEditSource, type PromptEditSource } from './edit/source'
import { usePromptEditFlow, type PromptEditFlow } from './edit/usePromptEditFlow'
import { fixBriefPrimary, useFixBrief } from './hooks/useFixBrief'
import { usePromptDetail } from './hooks/usePromptDetail'
import { useSourceActions } from '../sites/useSourceActions'
import { createPromptDetailSource, type PromptDetailSource } from './source'
import { pageScopeRefs } from '../visibility/aiContext'
import type { PromptDetailData, PromptTimeRow } from './types'
import {
  citationCounts,
  fixBrief,
  marketNameFor,
  neighbours,
  winningSampleIndex
} from './utils/model'
import { markdownCitations, overviewCitations, sourceLines } from '../sites/sources'
import '../m3/m3.css'
import './promptDetail.css'
import './aioOverview.css'
import './edit/promptEdit.css'
import './overviewInsights.css'

/** Scrolls to and focuses an element, such as a section heading. */
function focusById(id: string): void {
  const element = document.getElementById(id)
  if (!element) return
  // Section headings take focus from code only.
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
  element.scrollIntoView?.({ block: 'start' })
  element.focus()
}

const VIEW_KEYS = [PROMPT_VIEW_KEY, ENGINE_TAB_PARAM] as const
const ENGINE_TABS_ID = 'pd-engine'

/** Prompt detail (FR-13, Mockups/PromptDetail.dc.html). Opened from the prompt grid and drawers. */
export function PromptDetailScreen({
  source,
  projectId,
  projectName,
  pageId,
  promptId,
  marketId,
  runId = null,
  panel = null,
  onMarketChange,
  assistClient,
  editSource
}: {
  /** Tests only. Production uses the preload bridge. */
  source?: PromptDetailSource
  /** Tests only. Edit question and Re-check now; production uses the preload bridge. */
  editSource?: PromptEditSource
  /** Tests only. Production picks the assist client from the client mode. */
  assistClient?: AssistClient
  projectId: string
  projectName: string
  pageId: string
  promptId: string
  /** The page header's market. Undefined is the page's default market. */
  marketId: string | undefined
  /** A check pinned by the route (a drill from an older check). Null is the latest check. */
  runId?: string | null
  /** The panel the route opens (`?panel=`): Edit question or Re-check now. */
  panel?: PromptPanel | null
  onMarketChange: (marketId: string) => void
}): JSX.Element {
  const client = useMemo(() => source ?? createPromptDetailSource(), [source])
  const edits = useMemo(() => editSource ?? createPromptEditSource(), [editSource])
  const { state, reload } = usePromptDetail(
    client,
    projectId,
    pageId,
    promptId,
    marketId ?? null,
    runId,
    edits
  )
  const flow = usePromptEditFlow({
    editSource: edits,
    client,
    projectId,
    pageId,
    promptId,
    routeMarketId: marketId,
    panel
  })
  const recheck = <RecheckStatus state={flow.recheck} onDismiss={flow.dismiss} />

  if (state.status === 'loading') {
    return (
      <>
        <ScreenHeader title="Question detail" />
        {recheck}
        <p role="status">Loading the question…</p>
      </>
    )
  }
  if (state.status === 'error') {
    return (
      <>
        <ScreenHeader title="Question detail" />
        {recheck}
        <LoadError title="Could not load this question." message={state.message} onRetry={reload}>
          <LinkButton href={pageHash(pageId, 'results')}>Back to Results</LinkButton>
        </LoadError>
      </>
    )
  }
  return (
    <DrillHost>
      <PromptDetailBody
        key={`${state.data.detail.marketId}:${state.data.detail.runId ?? 'none'}:${promptId}`}
        data={state.data}
        timeline={state.timeline}
        historyError={state.historyError}
        onReload={reload}
        projectId={projectId}
        projectName={projectName}
        pageId={pageId}
        promptId={promptId}
        runId={runId}
        onMarketChange={onMarketChange}
        assistClient={assistClient}
        flow={flow}
        recheck={recheck}
        client={client}
      />
    </DrillHost>
  )
}

function PromptDetailBody({
  data,
  timeline,
  historyError,
  onReload,
  projectId,
  projectName,
  pageId,
  promptId,
  runId,
  onMarketChange,
  assistClient,
  flow,
  recheck,
  client
}: {
  data: PromptDetailData
  timeline: PromptTimeRow[] | null
  historyError: string | null
  onReload: () => void
  projectId: string
  projectName: string
  pageId: string
  promptId: string
  runId: string | null
  onMarketChange: (marketId: string) => void
  assistClient?: AssistClient
  flow: PromptEditFlow
  /** The re-check in line, under the header. */
  recheck: JSX.Element
  /** The screen's channels: `engines:question` for a tab per engine, the sources' actions. */
  client: PromptDetailSource
}): JSX.Element {
  const { page, results, detail, versions } = data
  const [sampleIndex, setSampleIndex] = useState(() => winningSampleIndex(detail))
  const row = detail.row
  const [query, setQuery] = useHashQuery(VIEW_KEYS)
  const pendingFocus = useRef<string | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  const sample = detail.samples[sampleIndex] ?? null
  const overview = useMemo(() => (sample ? overviewFromSample(sample) : null), [sample])
  // Answers from "Analyse with Claude" this visit, so switching samples keeps them.
  const [freshReads, setFreshReads] = useState<Readonly<Record<string, ShownRead>>>({})
  const savedRead = detail.overviewReads.find((read) => read.sampleId === sample?.id)
  const sampleRead: ShownRead | null =
    (sample ? freshReads[sample.id] : undefined) ??
    (savedRead ? { ...savedRead, footnote: null } : null)
  const topic = page.kind === 'topic'
  const sourceActions = useSourceActions(client, projectId, topic ? pageId : null)
  const marketName = marketNameFor(page.markets, detail.marketId)
  const references = sample?.references ?? row?.references ?? []
  const counts = citationCounts(references, row?.named ?? null)
  const cited = useMemo(
    () =>
      overview
        ? overviewCitations(overview)
        : sample?.aioMarkdown?.trim()
          ? markdownCitations(sample.aioMarkdown)
          : null,
    [overview, sample]
  )
  const lines = sourceLines(
    references.map((reference) => ({ ...reference, key: reference.id })),
    sourceActions.competitors,
    cited,
    sourceActions.tracked,
    sourceActions.settings
  )
  const nav = neighbours(results.prompts, promptId)
  const previous = results.comparison.find((column) => column.which === 'previous')
  const sinceLabel = previous?.finishedAt ? formatMonthDay(previous.finishedAt) : null
  const saved = versions?.steps[0]
  const fallback =
    saved?.texts.find((item) => item.marketId === detail.marketId)?.text ??
    detail.otherMarkets.find((other) => other.text.length > 0)?.text
  const market = page.markets.find((item) => item.id === detail.marketId) ?? null
  const drills = useMemo(
    () => buildResultsDrills(results, resultsScope(results, { pageId, market, runId })),
    [results, pageId, market, runId]
  )
  const checkedAt =
    (data.history?.points ?? []).find((point) => point.runId === detail.runId)?.finishedAt ??
    results.scope.checkedAt
  const questionText = row?.text ?? fallback ?? null
  useAiContext({
    entities: [
      ...(questionText ? [{ kind: 'question' as const, id: promptId, label: questionText }] : []),
      ...pageScopeRefs({
        pageId,
        page: pageLabel(page),
        market,
        runId: detail.runId,
        checkedAt
      })
    ],
    numbers: row ? [{ label: 'You', value: statusLabel(row.status) }] : []
  })
  const brief = fixBrief({
    pageUrl: page.url ?? '',
    marketName,
    detail,
    sample
  })
  const briefState = useFixBrief(brief)
  const assists = usePromptAssists({
    projectId,
    pageId,
    marketId: detail.marketId,
    promptId,
    first: row
      ? row.status === 'no_aio' || (row.status === 'page_cited' && row.position === 1)
      : true,
    ...(assistClient ? { client: assistClient } : {})
  })

  const tabs = [
    ...(row ? [{ id: 'overview' as const, label: 'AI Overview' }] : []),
    ...(row ? [{ id: 'sources' as const, label: 'Sources', count: references.length }] : []),
    { id: 'markets' as const, label: 'Markets', count: page.markets.length },
    {
      id: 'time' as const,
      label: 'Over time',
      ...(timeline ? { count: timeline.length } : {})
    },
    { id: 'raw' as const, label: 'Raw data' }
  ]
  // The open tab is in the URL (`?view=sources`); none is the first tab this prompt has.
  const firstTab: PromptTab = row ? 'overview' : 'markets'
  const asked = query[PROMPT_VIEW_KEY]
  const tab: PromptTab =
    isPromptTab(asked) && tabs.some((item) => item.id === asked) ? asked : firstTab
  function setTab(next: PromptTab): void {
    setQuery({ [PROMPT_VIEW_KEY]: next === firstTab ? null : next })
  }

  // Moves focus once the tab that holds the target has rendered.
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    focusById(id)
  }, [tab])

  function go(next: PromptTab, id: string): void {
    if (next === tab) {
      focusById(id)
      return
    }
    pendingFocus.current = id
    setTab(next)
  }

  // A tab per engine (`?eng=chatgpt`) when the page checks more than Google AI Overview.
  const engineView = useQuestionEngines(client['engines:question'], {
    projectId,
    pageId,
    promptId,
    marketId: detail.marketId
  })
  const answerTabs = engineTabs(engineView)
  const engineTab = engineTabOf(query[ENGINE_TAB_PARAM], answerTabs)
  const edit = promptEditParts({
    flow,
    pageId,
    promptId,
    title: row ? `Buyer question ${row.promptPosition}` : 'Question',
    rowText: row?.text ?? null,
    versions,
    markets: page.markets,
    marketId: detail.marketId,
    samples: page.samples,
    engines: (engineView?.engines ?? []).filter((item) => item.selected).map((item) => item.engine),
    engine: engineTab
  })
  const questionItems = useQuestionItems({
    projectId,
    question: { sourceId: pageId, promptId },
    text: row?.text ?? fallback ?? '',
    overviewText: sample?.errorCode === null ? (sample.aioText ?? null) : null
  })
  const promptItems = [...edit.items, ...questionItems]
  const points = data.history?.points ?? []
  // A pinned follow-up that is this market's newest check: the re-check just run.
  const pinnedRecheck =
    runId !== null &&
    points.some((point) => point.runId === runId && point.partial) &&
    points.at(-1)?.runId === runId
  const lastFull = results.scope.checkedAt
  const newerWording = !row && saved !== undefined && lastFull !== null && saved.savedAt > lastFull
  const answer =
    engineTab === 'google_aio' ? null : answerTabs.find((item) => item.engine === engineTab)
  const recheckRow = (timeline ?? [])
    .filter((item) => item.status !== null && item.runId !== detail.runId)
    .filter((item) => item.promptId === promptId)
    .at(-1)

  return (
    <div className="pd2" data-testid="prompt-detail">
      <PromptHeader
        nav={promptNav({
          projectName,
          pageId,
          pageLabel: pageLabel(page),
          promptNumber: row?.promptPosition ?? null,
          nav,
          scope: runId ? { marketId: detail.marketId, runId } : {}
        })}
        row={row}
        fallbackText={fallback ?? 'This question has no result in this market yet.'}
        markets={page.markets}
        marketId={detail.marketId}
        stageDrill={row ? drills.get(`stage:${row.intentStage}`) : null}
        onMarketChange={onMarketChange}
        onSamples={() => go('overview', 'pd-aio-h')}
        titleAction={edit.pencil}
        actions={
          row ? (
            <>
              <PinToSummary
                projectId={projectId}
                name="this question"
                spec={{
                  kind: 'question',
                  config: { pageId, promptId, label: row.text }
                }}
              />
              {assists.menu}
              <FixMoreMenu pageId={pageId} state={briefState} promptItems={promptItems} />
            </>
          ) : (
            <PromptMoreMenu items={promptItems} />
          )
        }
        {...(row ? { primary: fixBriefPrimary(briefState) } : {})}
      />
      {runId ? (
        <p className="pd2-pinned" role="note">
          {pinnedRecheck ? (
            <span>
              Showing this question’s re-check from{' '}
              <strong>{formatStamp(detail.row?.checkedAt ?? results.scope.checkedAt)}</strong>. The
              page’s score and its other questions come from the last full check.
            </span>
          ) : (
            <span>
              Showing this question in the check from{' '}
              <strong>{formatStamp(detail.row?.checkedAt ?? results.scope.checkedAt)}</strong>, not
              the latest one.
            </span>
          )}{' '}
          <a href={promptHash(pageId, promptId, { marketId: detail.marketId })}>
            {pinnedRecheck ? 'Show the last full check' : 'Show the latest check'}
          </a>
        </p>
      ) : null}
      {recheck}
      {topic ? (
        <div className="pd2-target-row">
          <QuestionTarget
            projectId={projectId}
            topicId={pageId}
            promptId={promptId}
            marketId={detail.marketId}
          />
        </div>
      ) : null}
      {edit.panel}
      {assists.card}
      {row && (briefState.open || briefState.copy === 'failed') ? (
        <FixBrief brief={brief} state={briefState} />
      ) : null}
      {answerTabs.length > 0 ? (
        <Tabs
          label="Engines"
          className="pd2-tabs"
          tabs={answerTabs.map((item) => ({
            id: item.engine,
            label: item.label,
            lead: <EngineDot status={item.status} />
          }))}
          value={engineTab}
          onChange={(next) => setQuery({ [ENGINE_TAB_PARAM]: next === 'google_aio' ? null : next })}
          panelId={ENGINE_TABS_ID}
        />
      ) : null}
      {answer ? (
        <TabPanel panelId={ENGINE_TABS_ID} id={answer.engine}>
          <EngineAnswer
            key={`${answer.engine}:${answer.checkedAt ?? ''}`}
            answer={answer}
            marketName={marketName}
            lens={detail.lens}
            topic={topic}
            sourceActions={sourceActions}
          />
        </TabPanel>
      ) : (
        <GoogleBody tabbed={answerTabs.length > 0}>
          {row ? (
            <PromptKpis
              row={row}
              sourceCount={references.length}
              counts={counts}
              sinceLabel={sinceLabel}
              onGo={go}
            />
          ) : (
            <Panel label="No result yet">
              <EmptyState
                title={
                  detail.runId === null
                    ? `No check has finished in ${marketName} yet.`
                    : newerWording
                      ? `This wording is newer than the last full check in ${marketName}.`
                      : `This question was not part of the latest check in ${marketName}.`
                }
                action={
                  newerWording ? (
                    <>
                      {recheckRow ? (
                        <LinkButton
                          href={promptHash(pageId, promptId, {
                            marketId: detail.marketId,
                            runId: recheckRow.runId
                          })}
                          size="sm"
                        >
                          Show the check from {formatDay(recheckRow.finishedAt, { year: false })}
                        </LinkButton>
                      ) : null}
                      <Button
                        size="sm"
                        variant="primary"
                        icon="refresh"
                        onClick={() => flow.open('recheck')}
                      >
                        Check now
                      </Button>
                    </>
                  ) : (
                    <LinkButton href={runningHash(pageId)} size="sm" variant="primary">
                      Check now
                    </LinkButton>
                  )
                }
              />
            </Panel>
          )}

          <Tabs
            label="Question sections"
            className="pd2-tabs"
            tabs={tabs}
            value={tab}
            onChange={setTab}
            panelId={PROMPT_TABS_ID}
            size={answerTabs.length > 0 ? 'sm' : 'md'}
          />
          <TabPanel panelId={PROMPT_TABS_ID} id={tab}>
            {tab === 'overview' && row ? (
              <div className="pd2-stack">
                <AioCard
                  sample={sample}
                  samples={detail.samples}
                  sampleIndex={sampleIndex}
                  onSample={setSampleIndex}
                  checkedAt={row.checkedAt ?? results.scope.checkedAt}
                  marketName={marketName}
                  lens={detail.lens}
                  extra={
                    <ToolButton
                      kind="refresh"
                      label="Check again"
                      busy={flow.recheck.status === 'running'}
                      onClick={() => flow.open('recheck')}
                    />
                  }
                />
                {sample && sample.errorCode === null && (overview || sample.aioText) ? (
                  <OverviewInsightsCard
                    key={sample.id}
                    sample={sample}
                    overview={overview}
                    lens={detail.lens}
                    read={sampleRead}
                    onRead={(read) =>
                      setFreshReads((current) => ({ ...current, [read.sampleId]: read }))
                    }
                    projectId={projectId}
                    pageId={pageId}
                    marketId={detail.marketId}
                    promptId={promptId}
                    {...(assistClient ? { assistClient } : {})}
                  />
                ) : null}
                {/* Full width above: the overview needs room for its sources rail. */}
                <div className="pd2-pair">
                  <GapCard
                    pageId={pageId}
                    gaps={detail.aioGap}
                    references={references}
                    onSource={(position) => {
                      setHighlight(position)
                      go('sources', 'pd-src-h')
                    }}
                  />
                  <CoverageCard pageId={pageId} row={row} whereCovered={detail.whereCovered} />
                </div>
                <GoogleSearchCard
                  key={`${detail.marketId}:${detail.runId ?? 'none'}`}
                  google={detail.google}
                  projectId={projectId}
                  target={{ id: pageId, name: pageLabel(page) }}
                />
              </div>
            ) : null}
            {tab === 'sources' && row ? (
              <SourcesCard
                headingId="pd-src-h"
                title="Sources Google listed"
                gridLabel="Sources in the order Google listed them"
                engine="Google"
                lines={lines}
                topic={topic}
                actions={sourceActions}
                domainDrill={(name) => drills.get(`domain:${name}`)}
                highlight={highlight}
              />
            ) : null}
            {tab === 'markets' ? (
              <MarketsCard
                pageId={pageId}
                markets={page.markets}
                defaultMarketId={page.defaultMarketId}
                marketId={detail.marketId}
                row={row}
                others={detail.otherMarkets}
                onMarketChange={onMarketChange}
              />
            ) : null}
            {tab === 'time' ? (
              <TimelineCard
                pageId={pageId}
                promptId={promptId}
                marketId={detail.marketId}
                currentRunId={detail.runId}
                rows={timeline}
                error={historyError}
                onRetry={onReload}
                wording={wordingChange(versions, detail.marketId)}
              />
            ) : null}
            {tab === 'raw' ? (
              <RawDataCard samples={detail.samples} searchesUsed={detail.searchesUsed} />
            ) : null}
          </TabPanel>
        </GoogleBody>
      )}
      <RemoveCompetitorConfirm pending={sourceActions.pendingRemoval} />
    </div>
  )
}

/** Google AI Overview's detail: in the engine tab's panel when the question has engine tabs. */
function GoogleBody({ tabbed, children }: { tabbed: boolean; children: ReactNode }): JSX.Element {
  return tabbed ? (
    <TabPanel panelId={ENGINE_TABS_ID} id="google_aio" className="pd2-engine-panel">
      {children}
    </TabPanel>
  ) : (
    <>{children}</>
  )
}
