import { useCallback, useMemo, useState, type JSX } from 'react'
import type {
  ApiKeyMetadata,
  ProjectSchedule,
  ProjectScoreSummary,
  ProjectUsageRow
} from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import type { AdminClient } from '../../admin/client'
import { useAiContext } from '../../assistant/context/useAiContext'
import { ScreenHeader } from '../../components/Header'
import { errorText } from '../../components/errorText'
import { sectionHash } from '../../shell/routes'
import { startProjectImport } from '../../transfer/actions'
import { Button, EmptyState, LinkButton, TabPanel, Tabs, type ListFilter } from '../../ui'
import type { ShellClient } from '../client'
import { EMPTY_PROJECT_FILTER, filterProjectDetails, type ProjectFilter } from '../listModel'
import type { ScoreBoard } from '../useShellData'
import { DeleteProjectConfirm } from './components/DeleteProjectConfirm'
import { GlanceStrip } from './components/GlanceStrip'
import { ProjectTable } from './components/ProjectTable'
import { UsageSection } from './components/UsageSection'
import { useProjectRowActions, useToggleWithUndo } from './hooks/useProjectRowActions'
import { useProjectFilter } from './hooks/useProjectFilter'
import { useProjectUsage } from './hooks/useProjectUsage'
import type { ProjectActions } from './types'
import { goToProject, type PageScoreRow } from './utils/drills'
import { useHashTab, withHashTab } from '../../shell/useHashTab'
import { focusWhenReady } from './utils/goTo'
import type { ProjectRow } from './utils/rows'
import './projects.css'

const NO_KEYS: readonly ApiKeyMetadata[] = []
const PANEL = 'projects-tabs'

type ProjectsTab = 'list' | 'usage'

const TAB_IDS: readonly ProjectsTab[] = ['list', 'usage']
type StatusWord = ProjectFilter['statuses'][number]
type KindWord = ProjectFilter['clients'][number]

function statusValue(filter: ProjectFilter): 'all' | StatusWord {
  return filter.statuses.length === 1 ? (filter.statuses[0] ?? 'all') : 'all'
}

function kindValue(filter: ProjectFilter): 'all' | KindWord {
  return filter.clients.length === 1 ? (filter.clients[0] ?? 'all') : 'all'
}

/** "2 active · 1 paused" under the heading. */
function statusLine(projects: readonly ProjectDetail[]): string {
  const count = (status: ProjectDetail['status']): number =>
    projects.filter((project) => project.status === status).length
  const parts = [`${count('active')} active`]
  if (count('paused') > 0) parts.push(`${count('paused')} paused`)
  if (count('archived') > 0) parts.push(`${count('archived')} archived`)
  return parts.join(' · ')
}

/**
 * FR-10.5–10.7 Projects: KPI tiles for every project at a glance, then tabs for
 * the project list grid and usage by project. New project opens its own screen.
 */
export function ProjectsScreen({
  client,
  admin,
  keys = NO_KEYS,
  projects,
  scores,
  onOpen,
  onCreated,
  onToggleStatus
}: {
  client: ShellClient
  /** Usage by project (FR-10.6). Optional for the Vite harness pages. */
  admin?: AdminClient
  /** Keys for the usage line under Usage by project. */
  keys?: readonly ApiKeyMetadata[]
  projects: readonly ProjectDetail[]
  scores: ScoreBoard
  onOpen: (projectId: string) => Promise<void>
  onCreated: () => Promise<void>
  onToggleStatus: (project: ProjectDetail) => Promise<void>
}): JSX.Element {
  const [filter, setFilter] = useProjectFilter()
  const [tab, setTab] = useHashTab<ProjectsTab>(TAB_IDS, 'list')
  // Bumped to start the grid afresh (its search clears), as "Show all N projects" does.
  const [gridKey, setGridKey] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const usage = useProjectUsage(admin, projects)
  // The delete confirm on the URL (`?delete=<project id>`): Back closes it.
  const deleteIds = useMemo(() => ['', ...projects.map((project) => project.id)], [projects])
  const [deleteId, setDeleteId] = useHashTab<string>(deleteIds, '', 'delete')
  const deleting = projects.find((project) => project.id === deleteId) ?? null
  const toggleWithUndo = useToggleWithUndo({ client, reload: onCreated, setError: setActionError })
  const edits = useProjectRowActions({
    client,
    admin,
    reload: onCreated,
    setError: setActionError,
    askDelete: setDeleteId
  })

  const scoreById = useMemo(() => {
    const map = new Map<string, ProjectScoreSummary>()
    for (const score of scores.projects?.projects ?? []) map.set(score.projectId, score)
    return map
  }, [scores.projects])
  const scheduleById = useMemo(() => {
    const map = new Map<string, ProjectSchedule>()
    for (const schedule of scores.schedules) map.set(schedule.projectId, schedule)
    return map
  }, [scores.schedules])
  const usageById = useMemo(() => {
    const map = new Map<string, ProjectUsageRow>()
    for (const row of usage.report?.projects ?? []) map.set(row.projectId, row)
    return map
  }, [usage.report])
  const rows = useMemo(
    () =>
      filterProjectDetails(projects, '', filter).map((project): ProjectRow => ({
        project,
        score: scoreById.get(project.id),
        schedule: scheduleById.get(project.id),
        usage: usageById.get(project.id)
      })),
    [projects, filter, scoreById, scheduleById, usageById]
  )
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )

  const loadPageScores = useCallback(
    async (projectId: string): Promise<readonly PageScoreRow[]> => {
      const [list, pages] = await Promise.all([
        client.listPageScores({ projectId }),
        client.listPages({ projectId })
      ])
      const labels = new Map(
        pages.pages.map((page) => [page.id, page.label ?? page.title ?? page.url])
      )
      return list.pages.map((page) => ({
        pageId: page.pageId,
        label: labels.get(page.pageId) ?? page.pageId,
        score: page.score,
        change: page.change
      }))
    },
    [client]
  )

  const actions = useMemo<ProjectActions>(
    () => ({
      onOpen,
      onToggleStatus: toggleWithUndo,
      onRestore: async (project) => {
        setActionError(null)
        try {
          await client.updateProject({ projectId: project.id, status: 'active' })
          await onCreated()
        } catch (error) {
          setActionError(errorText(error, 'Could not restore the project.'))
        }
      },
      onGo: (projectId, hash, focusId) => goToProject(onOpen, projectId, hash, focusId),
      loadPageScores,
      onSettings: (projectId) => {
        void onOpen(projectId).then(() => {
          window.location.hash = sectionHash('project-settings')
        })
      }
    }),
    [client, loadPageScores, onCreated, onOpen, toggleWithUndo]
  )

  const statusCount = (status: ProjectDetail['status']): string =>
    String(projects.filter((project) => project.status === status).length)
  useAiContext({
    filters: {
      status: statusValue(filter) === 'all' ? '' : statusValue(filter),
      kind: kindValue(filter) === 'all' ? '' : kindValue(filter)
    },
    numbers: [
      { label: 'Projects', value: String(projects.length) },
      { label: 'Active projects', value: statusCount('active') },
      { label: 'Paused projects', value: statusCount('paused') },
      { label: 'Archived projects', value: statusCount('archived') },
      { label: 'Projects shown', value: String(rows.length) }
    ]
  })

  function clearFilters(): void {
    setGridKey((current) => current + 1)
    setFilter(EMPTY_PROJECT_FILTER)
  }

  const archived = projects.some((project) => project.status === 'archived')
  const statusFilter: ListFilter = {
    label: 'Status',
    value: statusValue(filter),
    resetValue: 'all',
    options: [
      { value: 'all', label: 'All' },
      { value: 'Active', label: 'Active' },
      { value: 'Paused', label: 'Paused' },
      ...(archived || filter.statuses.includes('Archived')
        ? [{ value: 'Archived', label: 'Archived' }]
        : [])
    ],
    onChange: (value) =>
      setFilter((current) => ({
        ...current,
        statuses: value === 'all' ? [] : [value as StatusWord]
      }))
  }

  return (
    <div className="page-stack pj">
      <ScreenHeader
        title="Projects"
        subtitle={<p className="muted">{statusLine(projects)}</p>}
        primary={{ label: 'New project', icon: 'plus', href: sectionHash('new-project') }}
        moreLabel="Projects actions"
        more={[
          {
            id: 'projects-import',
            label: 'Import project…',
            icon: 'upload',
            onSelect: () => void startProjectImport()
          },
          {
            id: 'projects-connections',
            label: 'Shared connections',
            href: sectionHash('connections')
          }
        ]}
      />
      <GlanceStrip
        projects={projects}
        scores={scores}
        report={usage.report}
        actions={actions}
        onFilter={(next) => {
          if (next === null) clearFilters()
          else setFilter(next)
          setTab('list')
        }}
        onShowUsage={() => {
          setTab('usage')
          focusWhenReady('usage-h')
        }}
      />
      <div className="pj-tabs">
        <Tabs
          label="Projects sections"
          panelId={PANEL}
          value={tab}
          onChange={setTab}
          tabs={[
            {
              id: 'list',
              label: 'Projects',
              count: projects.length,
              href: sectionHash('projects')
            },
            {
              id: 'usage',
              label: 'Usage by project',
              href: withHashTab(sectionHash('projects'), 'usage')
            }
          ]}
        />
        {tab === 'list' ? (
          <TabPanel panelId={PANEL} id="list" className="pj-panel">
            {actionError ? (
              <p className="field-error" role="alert">
                {actionError}
              </p>
            ) : null}
            <ProjectTable
              key={gridKey}
              rows={rows}
              total={projects.length}
              actions={actions}
              statusFilter={statusFilter}
              edits={edits}
              onBulkToggle={onToggleStatus}
              kindFilter={{
                id: 'kind',
                label: 'Kind',
                value: kindValue(filter),
                resetValue: 'all',
                choices: [
                  { value: 'all', label: 'Any kind' },
                  { value: 'Own', label: 'Own' },
                  { value: 'Client', label: 'Client' }
                ],
                onChange: (value) =>
                  setFilter((current) => ({
                    ...current,
                    clients: value === 'Own' || value === 'Client' ? [value] : []
                  }))
              }}
              empty={
                projects.length === 0 ? (
                  <EmptyState
                    title="No projects yet"
                    body="Create a project to start tracking a website."
                    action={
                      <LinkButton size="sm" icon="plus" href={sectionHash('new-project')}>
                        New project
                      </LinkButton>
                    }
                  />
                ) : (
                  <EmptyState
                    icon="search"
                    title="No project matches these filters"
                    action={
                      <Button size="sm" onClick={clearFilters}>
                        Clear search and filters
                      </Button>
                    }
                  />
                )
              }
            />
            {deleting && admin ? (
              <DeleteProjectConfirm
                key={deleting.id}
                admin={admin}
                project={deleting}
                onCancel={() => setDeleteId('')}
                onDeleted={async () => {
                  setDeleteId('')
                  await onCreated()
                }}
              />
            ) : null}
          </TabPanel>
        ) : (
          <TabPanel panelId={PANEL} id="usage" className="pj-panel">
            <UsageSection
              report={usage.report}
              error={usage.error}
              keys={keys}
              scheduleById={scheduleById}
              projectById={projectById}
              actions={actions}
            />
          </TabPanel>
        )}
      </div>
    </div>
  )
}
