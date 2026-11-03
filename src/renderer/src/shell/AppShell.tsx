import { lazy, Suspense, useEffect, useMemo, useState, type JSX } from 'react'
import type { PageSummary } from '@shared/domain'
import type { PageDetail, PinnedPage, ProjectDetail } from '@shared/ipc'
import { createLiveAdminClient, type AdminClient } from '../admin/client'
import type { AllPagesSource } from '../allPages/source'
import { PageHeader, ScreenHeader } from '../components/Header'
import { PageProductField } from '../products/PageProductField'
import { LoadError } from '../components/LoadError'
import { LinkButton, TrackingChangesContext, UndoToastHost } from '../ui'
import { CelebrationHost } from '../celebrate/CelebrationHost'
import { errorText } from '../components/errorText'
import { PageTabs } from '../components/PageTabs'
import { Sidebar } from '../components/Sidebar'
import { StatusCapsule } from '../components/StatusCapsule'
import { SponsorCard } from '../sponsors'
import { ReleaseLine } from './ReleaseLine'
import { UpdateBanner } from '../updates/UpdateBanner'
import type { PlaygroundClient } from '../playground/client'
import type { ShellClient } from '../projects/client'
import { pageChromeFromDetail, pageChromeFromPinned, pageHeading } from '../projects/copy'
import { projectsForSwitcher } from '../projects/listModel'
import { useShellData } from '../projects/useShellData'
import { PageReadScreen } from '../pageSetup/PageReadScreen'
import { createLiveReportsClient, type ReportsClient } from '../reports/client'
import { createLiveSchedulesClient, type SchedulesClient } from '../reports/schedulesClient'
import { createLiveAlertsClient, type AlertsClient } from '../alerts/client'
import type { TemplatesClient } from '../templates/client'
import {
  PAGE_TABPANEL_ID,
  exportHash,
  isSectionCurrent,
  keepScreenQuery,
  landingHash,
  locationHash,
  navigateHash,
  pageHash,
  pageTabDomId,
  replaceHash,
  runningHash,
  sectionHash,
  topicHash,
  type PageTabId,
  type ShellLocation
} from './routes'
import { EngineRevisionContext, useEngineRevision } from './engineRevision'
import { isNotFoundError } from './notFound'
import { DrillHost } from '../drill/DrillHost'
import { AiContextProvider } from '../assistant/context/AiContextProvider'
import { AiSlotProvider } from '../assistant/sparkle/AiSlotProvider'
import { useAskShortcut } from '../assistant/useAskShortcut'
import { openAsk } from '../assistant/openAsk'
import { PageCheckButton } from '../checkNow/PageCheckButton'
import { DrawerHost } from './DrawerHost'
import { closeDrawersThen } from './drawers'
import { PageSettingsHost } from '../pageSettings/PageSettingsHost'
import { DrawerTrailContext, drawerRouteCrumbs } from './drawerCrumbs'
import { NoProject, PageMissing } from './RouteStates'
import { PageTabBody } from './PageTabBody'
import { SectionBody } from './SectionBody'
import { useProjectRoute } from './useProjectRoute'
import { useShellSearch } from './useShellSearch'
import { createQuestionSearchSource, type QuestionSearchSource } from './questionSearch'
import { breadcrumbFor } from './breadcrumb'
import { setupStepsLabel } from './model'
import { hueForLocation } from './sidebarNav'
import { useTopicNav } from '../topics/results/nav'
import { usePageFixCount } from '../fixes/hooks/usePageFixCount'
import { useTrackingChanges } from './useTrackingChanges'
import { SettingsMenu } from './SettingsMenu'
import { ThemeMenu } from './ThemeMenu'
import { useThemeChoice } from '../theme/useThemeChoice'
import { TopBar } from './TopBar'
import { TopBarSearch } from './TopBarSearch'
import { useSidebar } from './useSidebar'
import { ConsoleActivityButton } from '../console/ConsoleActivityButton'
import { startClient } from '../start/client'
import { GettingStartedStrip } from '../start/GettingStartedStrip'
import { useStartRedirect } from '../start/useStartRedirect'
import { useDiagnosticsMenu } from '../diagnostics/useDiagnosticsMenu'
import { useTransferMenu } from '../transfer/useTransferMenu'
import { useReadiness } from '../permissions/useReadiness'
import { GuideHost, GuideOverlays, GuidePill, PageHelpButton } from '../guide'

export function AppShell({
  location,
  bridgeError,
  client,
  templatesClient,
  playgroundClient,
  reportsClient,
  alertsClient,
  schedulesClient,
  adminClient,
  allPagesSource,
  questionSearch,
  content
}: {
  location: ShellLocation
  bridgeError: string | null
  client: ShellClient
  templatesClient: TemplatesClient
  playgroundClient: PlaygroundClient
  /** Optional so the Vite harness pages keep working. Defaults to the live adapter. */
  reportsClient?: ReportsClient
  /** Optional so the Vite harness pages keep working. Defaults to the live adapter. */
  alertsClient?: AlertsClient
  /** Optional so the Vite harness pages keep working. Defaults to the live adapter. */
  schedulesClient?: SchedulesClient
  /** Optional so the Vite harness pages keep working. Defaults to the live adapter. */
  adminClient?: AdminClient
  /** All pages channels. Unset uses the preload bridge. */
  allPagesSource?: AllPagesSource
  /** The top bar's question lookup. Unset uses the preload bridge. */
  questionSearch?: QuestionSearchSource
  /** Test harness only. Replaces the routed page. Production does not pass this. */
  content?: JSX.Element
}): JSX.Element {
  const reports = useMemo(() => reportsClient ?? createLiveReportsClient(), [reportsClient])
  const alerts = useMemo(() => alertsClient ?? createLiveAlertsClient(), [alertsClient])
  const schedules = useMemo(() => schedulesClient ?? createLiveSchedulesClient(), [schedulesClient])
  const admin = useMemo(() => adminClient ?? createLiveAdminClient(), [adminClient])
  const data = useShellData(client)
  const [statusOpen, setStatusOpen] = useState(false)
  const sidebar = useSidebar(data.app.snapshot?.settings.sidebar, (mode) =>
    client.updateSettings({ sidebar: mode })
  )
  // The sidebar Topics group: the open project's topics with their goal %.
  const topics = useTopicNav(data.active?.id ?? null)
  // The sidebar Fixes badge: page fixes to do.
  const pageFixes = usePageFixCount(data.active?.id ?? null, data.revision)
  // Grey chart markers for changes to what the project tracks (owner decision 1).
  const trackingChanges = useTrackingChanges(
    data.active?.id ?? null,
    `${data.revision}:${locationHash(location).split('?')[0] ?? ''}`
  )
  const [markets, setMarkets] = useState<Readonly<Record<string, string>>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const activeId = data.active?.id ?? null
  // File › Export / Import Project and App Settings.
  useTransferMenu(activeId)
  // Help › Report a problem…
  useDiagnosticsMenu(activeId)
  const questions = useMemo(() => questionSearch ?? createQuestionSearchSource(), [questionSearch])
  const search = useShellSearch(client, questions, activeId, setActionError)
  // Ctrl+K's "Switch theme to …", saved like the theme menu's choice.
  const chooseTheme = useThemeChoice(client)

  // A route that pins a market (a drill target) also becomes the page's picked market,
  // so it stays picked after the next navigation. Adjusted while rendering, not in an effect.
  const routeMarket =
    location.kind === 'page' || location.kind === 'prompt' || location.kind === 'topic'
      ? location.marketId
      : undefined
  const routePage = location.kind === 'section' ? null : location.pageId
  const routePick = routeMarket && routePage ? `${routePage}\0${routeMarket}` : null
  const [seenPick, setSeenPick] = useState<string | null>(null)
  if (routePick !== seenPick) {
    setSeenPick(routePick)
    if (routeMarket && routePage && markets[routePage] !== routeMarket) {
      setMarkets((current) => ({ ...current, [routePage]: routeMarket }))
    }
  }

  /** The market picker. Picking a market leaves a pinned market and check behind. */
  function pickMarket(pageId: string, marketId: string): void {
    setMarkets((current) => ({ ...current, [pageId]: marketId }))
    if (
      (location.kind === 'page' || location.kind === 'prompt') &&
      (location.marketId || location.runId)
    ) {
      navigateHash(
        keepScreenQuery(
          locationHash({ ...location, marketId: undefined, runId: undefined }),
          window.location.hash,
          ['market', 'run']
        )
      )
    }
  }

  function focusMain(): void {
    document.getElementById('main')?.focus()
  }

  async function selectProject(projectId: string): Promise<void> {
    setActionError(null)
    search.reset()
    try {
      const loaded = await data.selectProject(projectId)
      if (location.kind === 'section' || !loaded) return
      const openPageId = location.pageId
      const known =
        loaded.pinned.some((page) => page.id === openPageId) ||
        loaded.pages.some((page) => page.id === openPageId)
      if (!known) navigateHash(landingHash())
    } catch (error) {
      setActionError(errorText(error, 'Could not switch project.'))
    }
  }

  // A project route (`#/p/<projectId>/…`) switches project, then opens its route.
  const switchingTo = useProjectRoute({
    location,
    ready: data.ready && !data.loadFailed,
    activeId,
    selectProject: data.selectProject,
    onSwitching: () => {
      setActionError(null)
      search.reset()
    }
  })
  const switchingName = switchingTo
    ? (data.projects.find((project) => project.id === location.projectId)?.name ?? 'the project')
    : null
  const journey = startClient()
  useStartRedirect({
    location,
    projectId: activeId,
    ready: data.ready && !data.loadFailed && !switchingName,
    client: journey
  })

  async function onCreated(): Promise<void> {
    await data.reload()
  }

  async function onToggleStatus(project: ProjectDetail): Promise<void> {
    setActionError(null)
    try {
      const detail = await client.updateProject({
        projectId: project.id,
        status: project.status === 'paused' ? 'active' : 'paused'
      })
      data.applyProject(detail)
      await data.refreshActivity([detail.id])
    } catch (error) {
      setActionError(errorText(error, 'Could not update the project.'))
    }
  }

  async function onPin(page: Pick<PageSummary, 'id' | 'pinned'>): Promise<void> {
    if (!data.active) return
    setActionError(null)
    try {
      if (page.pinned) await client.unpinPage({ projectId: data.active.id, pageId: page.id })
      else await client.pinPage({ projectId: data.active.id, pageId: page.id })
      await data.refreshPages()
    } catch (error) {
      setActionError(errorText(error, 'Could not update the pin.'))
    }
  }

  const crumbPageId = location.kind === 'section' ? null : location.pageId
  const crumbPage = crumbPageId
    ? (data.pinned.find((page) => page.id === crumbPageId) ??
      data.pages.find((page) => page.id === crumbPageId))
    : undefined
  const crumbTopic =
    location.kind === 'topic' ? topics.find((topic) => topic.id === location.pageId) : undefined
  const crumbPageLabel = crumbTopic ? crumbTopic.title : crumbPage ? pageHeading(crumbPage) : null
  const projectName = data.active?.name ?? null
  const drawerTrail = useMemo(
    () => drawerRouteCrumbs(location, projectName, crumbPageLabel),
    [location, projectName, crumbPageLabel]
  )
  const crumbs = breadcrumbFor(location, data.active?.name ?? null, crumbPageLabel)
  // Ask CiteFox opens with or without a project (no project: app questions and setup help).
  const askOpen = useAskShortcut(data.ready)
  // The ⚙ menu's searches left and setup lines say what the searches-left button says.
  const ready = useReadiness(data.app.capsule)
  const searchesLeft = data.app.capsule?.searchesLeft ?? null

  function onAdded(pageId: string): void {
    void data.refreshActivity().then(() => navigateHash(pageHash(pageId, 'prompts')))
  }

  // The first-run journey is focus mode: no sidebar, its own quiet top bar.
  if (location.kind === 'section' && location.section === 'start' && data.ready && !switchingName) {
    return (
      <>
        <Suspense fallback={<p role="status">Loading…</p>}>
          <StartRoute
            step={location.focusId}
            project={data.active}
            searchesLeft={data.app.capsule?.searchesLeft ?? null}
            client={journey}
          />
        </Suspense>
        <ReleaseLine />
      </>
    )
  }

  const shell = (
    // Every drawer's crumbs start from the route under it (project › section › entity).
    <DrawerTrailContext.Provider value={drawerTrail}>
      <TrackingChangesContext.Provider value={trackingChanges}>
        {/* What Ask CiteFox and the ✦ menus know: the route here, each screen adds its part. */}
        <AiContextProvider
          location={location}
          projectId={activeId}
          projectName={projectName}
          crumbs={crumbs}
          pageName={crumbPageLabel}
        >
          <AiSlotProvider>
            {/* One drill drawer for the sidebar and the screen: the sidebar's "pages due today"
        opens the same drawer the screens use. */}
            <DrillHost resetKey={locationHash(location)}>
              <div className="app" data-sidebar={sidebar.collapsed ? 'collapsed' : 'expanded'}>
                <button type="button" className="skip-link" onClick={focusMain}>
                  Skip to main content
                </button>
                <Sidebar
                  location={location}
                  projects={projectsForSwitcher(data.projects)}
                  active={data.active}
                  foundPageCount={data.foundPageCount}
                  pinned={data.pinned}
                  tray={data.tray}
                  onSelectProject={(projectId) => void selectProject(projectId)}
                  collapsed={sidebar.collapsed}
                  onToggleCollapsed={sidebar.toggle}
                  topics={topics}
                  fixCount={pageFixes}
                  revision={data.revision}
                />
                <div className="app-col">
                  <TopBar
                    crumbs={crumbs}
                    onAsk={data.ready ? () => openAsk() : undefined}
                    askOpen={askOpen}
                    activity={<ConsoleActivityButton client={journey} />}
                    guide={<GuidePill />}
                    help={<PageHelpButton />}
                    search={
                      data.active ? (
                        <TopBarSearch
                          projectId={activeId}
                          onTheme={(theme) => void chooseTheme(theme)}
                          foundPageCount={data.foundPageCount}
                          query={search.query}
                          onQuery={search.setQuery}
                          pages={search.pages}
                          questions={search.questions}
                          topics={topics}
                        />
                      ) : undefined
                    }
                    status={
                      <StatusCapsule
                        capsule={data.app.capsule}
                        keys={data.app.keys}
                        checkup={data.app.overview?.claudeCheckup ?? null}
                        jinaMode={data.app.snapshot?.settings.jinaMode ?? null}
                        open={statusOpen}
                        onOpenChange={setStatusOpen}
                        current={isSectionCurrent(location, 'status')}
                      />
                    }
                    theme={<ThemeMenu client={client} />}
                    settings={
                      <SettingsMenu
                        searches={
                          searchesLeft === null
                            ? null
                            : `${searchesLeft.toLocaleString('en-US')} searches left`
                        }
                        setup={setupStepsLabel(ready)}
                        onOpenStatus={() => setStatusOpen(true)}
                      />
                    }
                  />
                  <GettingStartedStrip
                    client={journey}
                    projectId={activeId}
                    revision={data.revision}
                  />
                  <UpdateBanner />
                  <main
                    className={statusOpen ? 'main dim' : 'main'}
                    id="main"
                    tabIndex={-1}
                    data-hue={hueForLocation(location) ?? undefined}
                  >
                    <EngineRevisionContext.Provider value={data.revision}>
                      {content ?? (
                        <>
                          {bridgeError ? (
                            <p className="bridge-alert" role="alert">
                              {bridgeError}
                            </p>
                          ) : null}
                          {actionError || data.error ? (
                            <p className="bridge-alert" role="alert">
                              {actionError ?? data.error}
                            </p>
                          ) : null}
                          {!data.ready ? (
                            <p role="status">Loading projects…</p>
                          ) : data.loadFailed ? (
                            <>
                              <ScreenHeader title="CiteFox" />
                              <LoadError
                                title="CiteFox could not load your projects."
                                message={data.loadFailed}
                                onRetry={() => void data.reload()}
                              />
                            </>
                          ) : switchingName ? (
                            <p role="status">Opening {switchingName}…</p>
                          ) : location.kind === 'running' ? (
                            <Suspense fallback={<p role="status">Loading the check…</p>}>
                              <RunningPage
                                key={`${data.active?.id ?? 'none'}:${location.pageId}`}
                                client={client}
                                project={data.active}
                                pageId={location.pageId}
                              />
                            </Suspense>
                          ) : location.kind === 'topic' ? (
                            data.active ? (
                              <Suspense fallback={<p role="status">Loading topic…</p>}>
                                <TopicResultsScreen
                                  key={`${data.active.id}:${location.pageId}`}
                                  projectId={data.active.id}
                                  projectName={data.active.name}
                                  topicId={location.pageId}
                                  tab={location.tab}
                                  marketId={location.marketId ?? markets[location.pageId] ?? null}
                                  runId={location.runId ?? null}
                                  filter={location.filter ?? null}
                                />
                              </Suspense>
                            ) : (
                              <>
                                <ScreenHeader title="Topic" />
                                <NoProject />
                              </>
                            )
                          ) : location.kind === 'prompt' ? (
                            data.active ? (
                              <Suspense fallback={<p role="status">Loading the question…</p>}>
                                <PromptDetailScreen
                                  key={`${data.active.id}:${location.pageId}`}
                                  projectId={data.active.id}
                                  projectName={data.active.name}
                                  pageId={location.pageId}
                                  promptId={location.promptId}
                                  marketId={location.marketId ?? markets[location.pageId]}
                                  runId={location.runId ?? null}
                                  panel={location.panel ?? null}
                                  onMarketChange={(marketId) =>
                                    pickMarket(location.pageId, marketId)
                                  }
                                />
                              </Suspense>
                            ) : (
                              <>
                                <ScreenHeader title="Question" />
                                <NoProject />
                              </>
                            )
                          ) : location.kind === 'page' || location.kind === 'read' ? (
                            <PageRoute
                              key={`${data.active?.id ?? 'none'}:${location.pageId}:${location.kind}`}
                              client={client}
                              templatesClient={templatesClient}
                              project={data.active}
                              pageId={location.pageId}
                              tab={location.kind === 'page' ? location.tab : 'results'}
                              reading={location.kind === 'read'}
                              pinned={data.pinned}
                              onPin={onPin}
                              marketId={
                                (location.kind === 'page' ? location.marketId : undefined) ??
                                markets[location.pageId]
                              }
                              runId={location.kind === 'page' ? (location.runId ?? null) : null}
                              filter={location.kind === 'page' ? (location.filter ?? null) : null}
                              onMarketChange={(marketId) => pickMarket(location.pageId, marketId)}
                              onPagesChanged={() => void data.refreshPages()}
                            />
                          ) : (
                            <SectionBody
                              location={location}
                              client={client}
                              templatesClient={templatesClient}
                              playgroundClient={playgroundClient}
                              reportsClient={reports}
                              alertsClient={alerts}
                              schedulesClient={schedules}
                              adminClient={admin}
                              data={data}
                              allPagesSource={allPagesSource}
                              onPin={onPin}
                              onOpen={(projectId) =>
                                selectProject(projectId).then(() => navigateHash(landingHash()))
                              }
                              onCreated={onCreated}
                              onToggleStatus={onToggleStatus}
                              onAdded={onAdded}
                            />
                          )}
                        </>
                      )}
                      {/* The gold sponsor closes every screen, after its content. */}
                      <SponsorCard />
                      <ReleaseLine />
                    </EngineRevisionContext.Provider>
                  </main>
                </div>
                <DrawerHost
                  projectId={data.active?.id ?? null}
                  client={client}
                  onPagesChanged={() => void data.refreshActivity()}
                  onKeysChanged={() => void data.app.reload()}
                  onProjectsChanged={() => void data.reload()}
                  onSettingsChanged={() => void data.app.reload()}
                  onPageAdded={(pageId) =>
                    void data
                      .refreshActivity()
                      .then(() => closeDrawersThen(pageHash(pageId, 'prompts')))
                  }
                />
                <UndoToastHost />
                <CelebrationHost />
                <GuideOverlays />
              </div>
            </DrillHost>
          </AiSlotProvider>
        </AiContextProvider>
      </TrackingChangesContext.Provider>
    </DrawerTrailContext.Provider>
  )
  // The first-run guide reads the route and the open project's progress (src/renderer/src/guide).
  return (
    <GuideHost projectId={activeId} location={location} revision={data.revision}>
      {shell}
    </GuideHost>
  )
}

function PageRoute({
  client,
  templatesClient,
  project,
  pageId,
  tab,
  reading,
  pinned,
  marketId,
  runId,
  filter,
  onMarketChange,
  onPin,
  onPagesChanged
}: {
  client: ShellClient
  templatesClient: TemplatesClient
  project: ProjectDetail | null
  pageId: string
  tab: PageTabId
  reading: boolean
  pinned: readonly PinnedPage[]
  marketId: string | undefined
  /** A check pinned by the route (`?run=`). Null is the latest check. */
  runId: string | null
  /** A tab-defined filter or focus from the route (`?filter=`). */
  filter: string | null
  onMarketChange: (marketId: string) => void
  /** Pin / Unpin on the page header; refreshes the sidebar's Pinned list. */
  onPin: (page: Pick<PageSummary, 'id' | 'pinned'>) => Promise<void>
  /** A page was paused, pinned, renamed or removed: reload the sidebar's lists. */
  onPagesChanged: () => void
}): JSX.Element {
  const pinnedRow = pinned.find((item) => item.id === pageId) ?? null
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const pushed = useEngineRevision()

  useEffect(() => {
    if (!project) return
    let cancelled = false
    void client.getPage({ projectId: project.id, pageId }).then(
      (page) => {
        if (cancelled) return
        setDetail(page)
        setMissing(false)
        setFailed(null)
      },
      (cause: unknown) => {
        if (cancelled) return
        setDetail(null)
        if (isNotFoundError(cause)) setMissing(true)
        else setFailed(errorText(cause, 'Could not load this page.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, project, pageId, revision, pushed])

  // A topic's Results is the topic screen (#/topics/<id>); its other tabs stay page tabs.
  const topicResults = detail?.kind === 'topic' && tab === 'results' && !reading
  useEffect(() => {
    if (topicResults) replaceHash(topicHash(pageId, { marketId: marketId ?? null, runId }))
  }, [topicResults, pageId, marketId, runId])

  if (!project) {
    return (
      <>
        <ScreenHeader title="Page" />
        <NoProject />
      </>
    )
  }
  if (failed) {
    return (
      <>
        <ScreenHeader title="Page" />
        <LoadError
          title="CiteFox could not load this page."
          message={failed}
          onRetry={() => {
            setFailed(null)
            setRevision((current) => current + 1)
          }}
        >
          <LinkButton href={sectionHash('pages')}>Go to All pages</LinkButton>
        </LoadError>
      </>
    )
  }

  const chrome = detail
    ? pageChromeFromDetail(detail)
    : pinnedRow
      ? pageChromeFromPinned(pinnedRow)
      : null

  if (!chrome) {
    return (
      <>
        <ScreenHeader title="Page" />
        {missing ? <PageMissing /> : <p role="status">Loading page…</p>}
      </>
    )
  }
  const onPage = (id: string | null | undefined): id is string =>
    Boolean(id) && chrome.markets.some((market) => market.id === id)
  // The picked market, else the page's default market (FR-9.3), else the first one.
  const selectedMarket = onPage(marketId)
    ? marketId
    : onPage(detail?.defaultMarketId)
      ? detail.defaultMarketId
      : (chrome.markets[0]?.id ?? '')
  if (topicResults) return <p role="status">Opening topic…</p>
  if (reading && detail && project) {
    return <PageReadScreen client={client} projectId={project.id} page={detail} />
  }
  return (
    <>
      <PageHeader
        projectName={project?.name ?? 'Project'}
        page={chrome}
        marketId={selectedMarket}
        onMarketChange={onMarketChange}
        checkHref={runningHash(pageId)}
        exportHref={exportHash(pageId, selectedMarket || null)}
        checkPrimary={detail ? detail.score !== null : true}
        checkControl={
          detail && project ? (
            <PageCheckButton
              projectId={project.id}
              pageId={pageId}
              kind={detail.kind === 'topic' ? 'topic' : 'page'}
              marketId={selectedMarket}
              markets={detail.markets}
              samples={detail.samples}
              href={runningHash(pageId)}
              primary={detail.score !== null}
            />
          ) : undefined
        }
        pin={
          detail?.kind === 'topic'
            ? undefined
            : {
                pinned: pinnedRow !== null,
                onToggle: () => void onPin({ id: pageId, pinned: pinnedRow !== null })
              }
        }
        productField={
          project ? <PageProductField projectId={project.id} pageId={pageId} /> : undefined
        }
        pageId={detail ? pageId : undefined}
        paused={detail?.status === 'paused'}
        onMarketAdded={(added) => {
          setRevision((current) => current + 1)
          onMarketChange(added)
        }}
      />
      {detail ? (
        <PageSettingsHost
          client={client}
          projectId={project.id}
          page={detail}
          onChanged={(next) => {
            if (next) setDetail(next)
            setRevision((current) => current + 1)
            onPagesChanged()
          }}
          onPinsChanged={onPagesChanged}
        />
      ) : null}
      <PageTabs pageId={pageId} activeTab={tab} />
      <div
        className="tab-panel ps-stack"
        role="tabpanel"
        id={PAGE_TABPANEL_ID}
        aria-labelledby={pageTabDomId(tab)}
        tabIndex={0}
      >
        {detail && project ? (
          <PageTabBody
            client={client}
            templatesClient={templatesClient}
            projectId={project.id}
            projectName={project.name}
            page={detail}
            tab={tab}
            marketId={selectedMarket}
            runId={runId}
            filter={filter}
            onChanged={() => setRevision((current) => current + 1)}
          />
        ) : null}
      </div>
    </>
  )
}

const StartRoute = lazy(() =>
  import('../start/StartRoute').then((module) => ({ default: module.StartRoute }))
)
const TopicResultsScreen = lazy(() =>
  import('../topics/results').then((module) => ({ default: module.TopicResultsScreen }))
)
const RunningPage = lazy(() =>
  import('../m3/RunningPage').then((module) => ({ default: module.RunningPage }))
)
const PromptDetailScreen = lazy(() =>
  import('../promptDetail').then((module) => ({ default: module.PromptDetailScreen }))
)
