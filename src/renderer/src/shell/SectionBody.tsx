import { lazy, Suspense, useCallback, useMemo, type JSX } from 'react'
import { AskRedirect } from '../assistant/AskRedirect'
import type { Market, PageSummary, ProjectSchedule } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { AdminClient } from '../admin/client'
import { AllPagesScreen } from '../allPages'
import type { AllPagesSource } from '../allPages/source'
import { ConnectionsScreen } from '../connections/ConnectionsScreen'
import { PermissionsScreen } from '../permissions/PermissionsScreen'
import { ScreenHeader } from '../components/Header'
import { LoadError } from '../components/LoadError'
import { PlaygroundRoute } from '../playground/PlaygroundRoute'
import { ProjectSettingsScreen } from '../projectSettings'
import type { PlaygroundClient } from '../playground/client'
import { AddPageScreen } from '../projects/AddPageScreen'
import { CheckNowScreen } from '../projects/CheckNowScreen'
import type { ShellClient } from '../projects/client'
import { NewProjectForm } from '../projects/NewProjectForm'
import { ProjectsScreen } from '../projects/projectsScreen'
import type { useShellData } from '../projects/useShellData'
import { SettingsScreen } from '../settings/SettingsScreen'
import { ExportScreen } from '../reports/export'
import { AlertsScreen } from '../alerts/AlertsScreen'
import type { ProjectScheduleRow } from '../alerts/model'
import { ReportsScreen } from '../reports/ReportsScreen'
import { createLiveReviewClient } from '../reports/review/client'
import { summaryPageLookup } from '../reports/schedules/utils/summaryPage'
import type { ReportsClient } from '../reports/client'
import type { SchedulesClient } from '../reports/schedulesClient'
import type { AlertsClient } from '../alerts/client'
import { TemplatesScreen } from '../templates/TemplatesScreen'
import { createStructureClient } from '../structure/client'
import { StructureRedirect } from '../structure/StructureRedirect'
import type { TemplatesClient } from '../templates/client'
import type { WizardProject } from '../topics/wizard/types'
import { CitationsSection } from './CitationsSection'
import { marketLabel } from './model'
import {
  CompetitorsSection,
  FixesSection,
  HistorySection,
  OverviewSection,
  QuestionsSection,
  TopicsSection
} from './placeholders'
import { MovedRedirect, NoProject, Unavailable } from './RouteStates'
import {
  exportMarketFromHash,
  exportPageFromHash,
  isSectionCurrent,
  movedSettingsHash,
  navigateHash,
  pageHash,
  sectionHash,
  sectionHeading,
  type SectionId,
  type ShellLocation
} from './routes'
import { SectionFrame } from './SectionFrame'
import { hubFor } from './hubs'
import { HubTabs } from './HubTabs'

/** Project-level AI visibility screens: each takes the open project's id. */
const PROJECT_SECTIONS: Partial<Record<SectionId, (props: { projectId: string }) => JSX.Element>> =
  {
    overview: OverviewSection,
    questions: QuestionsSection,
    topics: TopicsSection,
    competitors: CompetitorsSection,
    fixes: FixesSection,
    history: HistorySection
  }

/**
 * The screen for a section route. Header rule: a screen that draws its own
 * header is mounted bare; every other one gets the one standard header
 * (`SectionFrame`: title, no in-page breadcrumb, the top bar holds the only
 * one). Either way a route shows exactly one header.
 */
export function SectionBody(props: SectionBodyProps): JSX.Element {
  const hub = props.location.kind === 'section' ? hubFor(props.location.section) : null
  if (hub === null) return <SectionScreen {...props} />
  // Pages and Settings hubs: the tab bar above the screen; each tab keeps its own address.
  return (
    <>
      <HubTabs hub={hub.hub} current={hub.tab} />
      <SectionScreen {...props} />
    </>
  )
}

interface SectionBodyProps {
  location: ShellLocation
  client: ShellClient
  templatesClient: TemplatesClient
  playgroundClient: PlaygroundClient
  reportsClient: ReportsClient
  alertsClient: AlertsClient
  schedulesClient: SchedulesClient
  adminClient: AdminClient
  data: ReturnType<typeof useShellData>
  allPagesSource: AllPagesSource | undefined
  onPin: (page: Pick<PageSummary, 'id' | 'pinned'>) => Promise<void>
  onOpen: (projectId: string) => Promise<void>
  onCreated: () => Promise<void>
  onToggleStatus: (project: ProjectDetail) => Promise<void>
  onAdded: (pageId: string) => void
}

function SectionScreen({
  location,
  client,
  templatesClient,
  playgroundClient,
  reportsClient,
  alertsClient,
  schedulesClient,
  adminClient,
  data,
  allPagesSource,
  onPin,
  onOpen,
  onCreated,
  onToggleStatus,
  onAdded
}: SectionBodyProps): JSX.Element {
  const exportProject = useMemo(
    () =>
      data.active
        ? {
            id: data.active.id,
            name: data.active.name,
            defaultMarket: data.active.defaultMarket
          }
        : null,
    [data.active]
  )
  const exportPages = useMemo(
    () =>
      data.pages.map((page) => ({
        id: page.id,
        label: page.label ?? page.title ?? page.url ?? page.id,
        ...(page.kind ? { kind: page.kind } : {})
      })),
    [data.pages]
  )
  const projectSchedules = useMemo(
    () => scheduleRowsFor(data.projects, data.scores.schedules),
    [data.projects, data.scores.schedules]
  )
  const activeProjectId = data.active?.id ?? null
  const structureClient = useMemo(() => createStructureClient(), [])
  const reviewClient = useMemo(() => createLiveReviewClient(), [])
  const reviewProject = useMemo(
    () =>
      data.active
        ? {
            id: data.active.id,
            name: data.active.name,
            domain: data.active.domain,
            brand: data.active.brandNames[0] ?? data.active.name,
            defaultMarket: data.active.defaultMarket,
            markets:
              data.active.markets ?? (data.active.defaultMarket ? [data.active.defaultMarket] : [])
          }
        : null,
    [data.active]
  )
  // Scheduled reports' AI summary preview reads the project's first checked page.
  const summaryPage = useMemo(
    () => summaryPageLookup((request) => client.listPages(request)),
    [client]
  )
  const readExportPage = useCallback(
    (pageId: string) => {
      if (!activeProjectId) return Promise.resolve({ markets: [] })
      return client.getPage({ projectId: activeProjectId, pageId })
    },
    [client, activeProjectId]
  )
  if (location.kind !== 'section') return <ScreenHeader title={data.active?.name ?? 'CiteFox'} />
  const { section } = location
  // A setting that moved to its one home: the old address opens the new one.
  const moved = movedSettingsHash(window.location.hash)
  if (moved) return <MovedRedirect hash={moved} />

  if (section === 'unavailable') return <Unavailable reason={location.focusId} />

  const ProjectScreen = PROJECT_SECTIONS[section]
  if (ProjectScreen || section === 'citations' || section === 'communities') {
    if (!data.active) {
      return (
        <SectionFrame title={sectionHeading(section)}>
          <NoProject />
        </SectionFrame>
      )
    }
    if (section === 'citations') {
      return <CitationsSection key={data.active.id} project={data.active} />
    }
    if (section === 'communities') {
      // Draws its own header (the standard SectionFrame) once it loads.
      return (
        <Suspense fallback={<p role="status">Loading communities…</p>}>
          <ProjectCommunitiesScreen
            key={data.active.id}
            projectId={data.active.id}
            markets={projectMarkets(data.active)}
            pages={data.pages}
          />
        </Suspense>
      )
    }
    if (ProjectScreen) return <ProjectScreen key={data.active.id} projectId={data.active.id} />
  }

  if (isSectionCurrent(location, 'pages')) {
    return (
      <AllPagesScreen
        {...(allPagesSource ? { source: allPagesSource } : {})}
        structureClient={structureClient}
        project={data.active}
        params={location.params}
        onPin={onPin}
        onOpenPage={(pageId) => navigateHash(pageHash(pageId))}
      />
    )
  }
  if (isSectionCurrent(location, 'projects')) {
    return (
      <ProjectsScreen
        client={client}
        admin={adminClient}
        keys={data.app.keys}
        projects={data.projects}
        scores={data.scores}
        onOpen={onOpen}
        onCreated={onCreated}
        onToggleStatus={onToggleStatus}
      />
    )
  }
  if (isSectionCurrent(location, 'new-project')) {
    return (
      <NewProjectForm
        client={client}
        heading="h1"
        projects={data.projects}
        keys={data.app.keys}
        onCreated={onCreated}
      />
    )
  }
  if (isSectionCurrent(location, 'reports')) {
    return (
      <ReportsScreen
        client={schedulesClient}
        projects={data.projects}
        currentProjectId={data.active?.id ?? null}
        onOpenProject={(projectId) => void onOpen(projectId)}
        summaryPage={summaryPage}
        reviewClient={reviewClient}
        project={reviewProject}
        pages={data.pages}
      />
    )
  }
  if (isSectionCurrent(location, 'alerts')) {
    return (
      <AlertsScreen
        client={alertsClient}
        projectId={data.active?.id ?? null}
        projectName={data.active?.name ?? 'this project'}
        focus={location.focusId}
        {...(location.params?.tab ? { tabParam: location.params.tab } : {})}
      />
    )
  }
  if (isSectionCurrent(location, 'export')) {
    return (
      <ExportScreen
        client={reportsClient}
        project={exportProject}
        pages={exportPages}
        initialPageId={exportPageFromHash(window.location.hash)}
        initialMarketId={exportMarketFromHash(window.location.hash)}
        readPage={exportProject ? readExportPage : undefined}
        schedulesClient={schedulesClient}
        projects={data.projects}
      />
    )
  }
  if (isSectionCurrent(location, 'status')) {
    return (
      <Suspense fallback={<p role="status">Loading status…</p>}>
        <StatusScreen />
      </Suspense>
    )
  }
  if (isSectionCurrent(location, 'import-pages')) {
    return (
      <Suspense fallback={<p role="status">Loading Import pages…</p>}>
        <ImportPagesScreen
          key={data.active?.id ?? 'none'}
          client={structureClient}
          project={data.active}
          onTracked={() => void data.refreshActivity()}
        />
      </Suspense>
    )
  }
  if (isSectionCurrent(location, 'structure')) {
    // Site structure is Pages' Tree view: an old #/structure link opens it there.
    return <StructureRedirect />
  }
  if (isSectionCurrent(location, 'add')) {
    return (
      <Suspense fallback={<p role="status">Loading…</p>}>
        <TopicWizard
          key={data.active?.id ?? 'none'}
          project={wizardProject(data.active)}
          draftId={location.focusId ?? null}
        />
      </Suspense>
    )
  }
  if (isSectionCurrent(location, 'add-page')) {
    return (
      <AddPageScreen
        key={data.active?.id ?? 'none'}
        client={client}
        project={data.active}
        onAdded={onAdded}
        onBack={() => navigateHash(sectionHash('add'))}
      />
    )
  }
  return (
    <SectionFrame title={sectionHeading(section)}>
      {section === 'connections' ? (
        data.app.overview ? (
          <ConnectionsScreen
            client={client}
            overview={data.app.overview}
            claudeModel={data.app.snapshot?.settings.claudeModel ?? null}
            admin={adminClient}
            projects={data.projects}
            onChanged={data.app.reload}
          />
        ) : data.app.overviewError ? (
          <LoadError
            title="CiteFox could not load your connections."
            message={data.app.overviewError}
            onRetry={() => void data.app.reload()}
          />
        ) : (
          <p role="status">Loading connections…</p>
        )
      ) : section === 'permissions' ? (
        <PermissionsScreen focusId={location.focusId ?? null} />
      ) : section === 'templates' ? (
        <TemplatesScreen
          client={templatesClient}
          projectId={data.active?.id ?? null}
          focusId={location.focusId ?? null}
        />
      ) : section === 'playground' ? (
        <PlaygroundRoute
          client={playgroundClient}
          projectId={data.active?.id ?? ''}
          projects={data.projects}
          focusId={location.focusId}
        />
      ) : section === 'settings' ? (
        data.app.overview && data.app.settingsDraft && data.app.snapshot ? (
          <SettingsScreen
            client={client}
            alertsClient={alertsClient}
            activeProjectId={data.active?.id ?? null}
            overview={data.app.overview}
            settings={data.app.settingsDraft}
            dataDirectory={data.app.snapshot.dataDirectory}
            onChanged={data.app.reload}
            previewSample={{
              brand: data.active?.brandNames[0] ?? null,
              site: data.active?.domain ?? null
            }}
          />
        ) : data.app.settingsError || data.app.overviewError ? (
          <LoadError
            title="CiteFox could not load your settings."
            message={data.app.settingsError ?? data.app.overviewError}
            onRetry={() => void data.app.reload()}
          />
        ) : (
          <p role="status">Loading settings…</p>
        )
      ) : section === 'project-settings' ? (
        <ProjectSettingsScreen
          key={data.active?.id ?? 'none'}
          client={client}
          admin={adminClient}
          alertsClient={alertsClient}
          templatesClient={templatesClient}
          project={data.active}
          projects={data.projects}
          projectSchedules={projectSchedules}
          keys={data.app.keys}
          onChanged={data.reload}
          onDeleted={async () => {
            await data.reload()
            navigateHash(sectionHash('projects'))
          }}
        />
      ) : section === 'ask' ? (
        // Ask CiteFox is a drawer now: an old #/ask link opens it over its screen.
        <AskRedirect />
      ) : section === 'youtube' ? (
        <Suspense fallback={<p role="status">Loading YouTube…</p>}>
          <VideosScreen projectId={data.active?.id ?? null} pages={data.pages} />
        </Suspense>
      ) : section === 'check' ? (
        <CheckNowScreen
          client={client}
          pausedProject={data.active?.status === 'paused'}
          projectId={data.active?.id ?? null}
        />
      ) : (
        <div className="route-body" />
      )}
    </SectionFrame>
  )
}

const TopicWizard = lazy(() =>
  import('../topics/wizard').then((module) => ({ default: module.TopicWizard }))
)
const ImportPagesScreen = lazy(() =>
  import('../importPages').then((module) => ({ default: module.ImportPagesScreen }))
)
const StatusScreen = lazy(() =>
  import('../status').then((module) => ({ default: module.StatusScreen }))
)
const VideosScreen = lazy(() =>
  import('../videos').then((module) => ({ default: module.VideosScreen }))
)
const ProjectCommunitiesScreen = lazy(() =>
  import('../communities').then((module) => ({ default: module.ProjectCommunitiesScreen }))
)

/** The open project's markets; an older project may only carry its default one. */
function projectMarkets(project: ProjectDetail): readonly Market[] {
  return project.markets ?? (project.defaultMarket ? [project.defaultMarket] : [])
}

/** The open project as the Add wizard needs it. */
function wizardProject(project: ProjectDetail | null): WizardProject | null {
  if (!project) return null
  const markets = projectMarkets(project)
  return {
    id: project.id,
    name: project.name,
    domain: project.domain,
    markets: markets.map((market) => ({ id: market.id, label: marketLabel(market) })),
    brandNames: project.brandNames,
    competitors: project.competitors,
    switchingFrom: project.switchingFrom ?? []
  }
}

function scheduleRowsFor(
  projects: readonly ProjectDetail[],
  schedules: readonly ProjectSchedule[]
): ProjectScheduleRow[] {
  return projects.flatMap((project) => {
    const schedule = schedules.find((item) => item.projectId === project.id)
    if (!schedule) return []
    return [
      {
        projectId: project.id,
        name: project.name,
        intervalDays: schedule.defaultIntervalDays,
        time: schedule.dailyCheckTime,
        paused: schedule.paused
      }
    ]
  })
}
