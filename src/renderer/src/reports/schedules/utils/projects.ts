import type { ProjectDetail } from '@shared/ipc'
import { marketLabel } from '../../../shell/model'
import { type MarketOption, type NamedProject } from '../../scheduleModel'

export function namedProject(project: ProjectDetail): NamedProject {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    clientName: project.clientName
  }
}

export function projectOptionLabel(project: NamedProject): string {
  if (project.status === 'paused') return `${project.name} (paused)`
  if (project.clientName) return `${project.name} (client)`
  return project.name
}

export function marketsFor(
  projectId: string | null,
  projects: readonly ProjectDetail[]
): MarketOption[] {
  const source =
    projectId === null ? projects : projects.filter((project) => project.id === projectId)
  const seen = new Map<string, MarketOption>()
  for (const project of source) {
    const market = project.defaultMarket
    if (!market || seen.has(market.id)) continue
    seen.set(market.id, { id: market.id, label: marketLabel(market) })
  }
  return [...seen.values()]
}
