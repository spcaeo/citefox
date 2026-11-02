import type { ProjectDetail, ProjectList } from '@shared/ipc'
import type { ShellClient } from './client'

/**
 * The active project is `projects:list.activeProjectId`.
 * A switch or a create updates that field. This does not keep a second copy.
 */
export function activeDetail(
  list: ProjectList,
  details: readonly ProjectDetail[]
): ProjectDetail | null {
  if (list.activeProjectId === null) return null
  return details.find((project) => project.id === list.activeProjectId) ?? null
}

export async function readActiveProject(client: ShellClient): Promise<{
  list: ProjectList
  details: readonly ProjectDetail[]
  active: ProjectDetail | null
}> {
  const list = await client.listProjects()
  const details = await Promise.all(
    list.projects.map((project) => client.getProject({ projectId: project.id }))
  )
  return { list, details, active: activeDetail(list, details) }
}
