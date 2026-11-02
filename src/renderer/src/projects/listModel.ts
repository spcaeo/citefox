import type { ProjectSummary } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'

export interface ProjectFilter {
  statuses: readonly ('Active' | 'Paused' | 'Archived')[]
  clients: readonly ('Client' | 'Own')[]
}

export const EMPTY_PROJECT_FILTER: ProjectFilter = { statuses: [], clients: [] }

export function projectsForSwitcher(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return projects.filter((project) => project.status !== 'archived')
}

export function projectKind(project: Pick<ProjectSummary, 'clientName'>): 'Client' | 'Own' {
  return project.clientName ? 'Client' : 'Own'
}

export function projectStatusWord(
  status: ProjectSummary['status']
): 'Active' | 'Paused' | 'Archived' {
  if (status === 'active') return 'Active'
  if (status === 'paused') return 'Paused'
  return 'Archived'
}

export function filterProjectDetails(
  projects: readonly ProjectDetail[],
  query: string,
  filter: ProjectFilter
): ProjectDetail[] {
  const needle = query.trim().toLowerCase()
  return projects.filter((project) => {
    if (needle) {
      const fields = [project.name, project.domain, project.clientName ?? '', projectKind(project)]
      if (!fields.some((field) => field.toLowerCase().includes(needle))) return false
    }
    if (
      filter.statuses.length > 0 &&
      !filter.statuses.includes(projectStatusWord(project.status))
    ) {
      return false
    }
    if (filter.clients.length > 0 && !filter.clients.includes(projectKind(project))) return false
    return true
  })
}

export function projectFacetCount(
  projects: readonly ProjectDetail[],
  query: string,
  filter: ProjectFilter,
  facet: 'status' | 'client',
  value: string
): number {
  const without: ProjectFilter =
    facet === 'status' ? { ...filter, statuses: [] } : { ...filter, clients: [] }
  return filterProjectDetails(projects, query, without).filter((project) => {
    if (facet === 'status') return projectStatusWord(project.status) === value
    return projectKind(project) === value
  }).length
}

export type ProjectSortKey = 'name' | 'domain' | 'tracked' | 'status'

export function trackedFoundTotals(
  projects: readonly Pick<ProjectDetail, 'trackedPageCount' | 'foundPageCount'>[]
): { tracked: number; found: number } {
  return projects.reduce(
    (sum, project) => ({
      tracked: sum.tracked + project.trackedPageCount,
      found: sum.found + project.foundPageCount
    }),
    { tracked: 0, found: 0 }
  )
}

export function sortProjectDetails(
  projects: readonly ProjectDetail[],
  key: ProjectSortKey,
  dir: 'asc' | 'desc'
): ProjectDetail[] {
  const indexed = projects.map((project, index) => ({ project, index }))
  indexed.sort((a, b) => {
    const compared = compareProject(a.project, b.project, key)
    if (compared !== 0) return dir === 'desc' ? -compared : compared
    return a.index - b.index
  })
  return indexed.map((item) => item.project)
}

function compareProject(a: ProjectDetail, b: ProjectDetail, key: ProjectSortKey): number {
  if (key === 'tracked') return a.trackedPageCount - b.trackedPageCount
  if (key === 'status')
    return projectStatusWord(a.status).localeCompare(projectStatusWord(b.status))
  if (key === 'domain') return a.domain.localeCompare(b.domain)
  return a.name.localeCompare(b.name)
}

export function activeSummary(projects: readonly ProjectSummary[]): string {
  const active = projects.filter((project) => project.status === 'active').length
  const paused = projects.filter((project) => project.status === 'paused').length
  const archived = projects.filter((project) => project.status === 'archived').length
  const parts = [
    `${active} active`,
    paused > 0 ? `${paused} paused` : null,
    archived > 0 ? `${archived} archived` : null
  ].filter((part): part is string => part !== null)
  return parts.join(' · ')
}
