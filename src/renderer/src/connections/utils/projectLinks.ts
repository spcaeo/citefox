import { useEffect, useState } from 'react'
import type { DrillTarget } from '../../drill'
import { projectHash, sectionHash } from '../../shell/routes'

export interface ProjectLink {
  target: DrillTarget
  /** Accessible words for where the link goes. */
  label: string
}

/**
 * Where a project name opens: that project's Project settings. Project
 * settings belong to the open project, so another project's link is a project
 * route that switches to it first, in one step.
 */
export function projectSettingsLink(
  project: { id: string; name: string },
  activeProjectId: string | null,
  part?: string
): ProjectLink {
  const section = `Project settings${part ? ` › ${part}` : ''}`
  if (project.id === activeProjectId) {
    return {
      target: { kind: 'hash', hash: sectionHash('project-settings') },
      label: `Open ${project.name} ${section}`
    }
  }
  return {
    target: { kind: 'hash', hash: projectHash(project.id, sectionHash('project-settings')) },
    label: `Switch to ${project.name} and open its ${section}`
  }
}

/**
 * The open project's id from `projects:list`. Null until it loads, or when
 * there is no preload bridge (tests). With one project, that project is open.
 */
export function useActiveProjectId(projects: readonly { id: string }[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.citefox) return
    let cancelled = false
    window.citefox['projects:list']().then(
      (list) => {
        if (!cancelled) setActive(list.activeProjectId)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [projects])
  if (active !== null) return active
  return projects.length === 1 ? (projects[0]?.id ?? null) : null
}
