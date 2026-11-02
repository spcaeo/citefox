import { useEffect, useRef } from 'react'
import {
  keepScreenQuery,
  locationHash,
  plainLocation,
  replaceHash,
  unavailableHash,
  type ShellLocation
} from './routes'

/**
 * Opens a project route (`#/p/<projectId>/…`, built with `projectHash`) in one
 * step: switches to that project when it is not the open one, then replaces
 * the hash with the plain route, so Back skips the project route. A project
 * that cannot be opened (deleted, or a link from another computer) shows the
 * plain "not available to you" state, `#/unavailable/project`.
 *
 * Returns true while the switch is pending, so the shell does not render the
 * route against the wrong project.
 */
export function useProjectRoute({
  location,
  ready,
  activeId,
  selectProject,
  onSwitching
}: {
  location: ShellLocation
  /** True once projects have loaded. */
  ready: boolean
  activeId: string | null
  /** Switches project. Rejects when the project cannot be opened. */
  selectProject: (projectId: string) => Promise<unknown>
  /** Runs once when a switch starts (clears the sidebar search). */
  onSwitching: () => void
}): boolean {
  const projectId = location.projectId ?? null
  // The route model drops a screen's own query values; the rewrite keeps them.
  const plain = keepScreenQuery(locationHash(plainLocation(location)), window.location.hash)
  const inFlight = useRef<string | null>(null)
  const callbacks = useRef({ selectProject, onSwitching })
  useEffect(() => {
    callbacks.current = { selectProject, onSwitching }
  })

  useEffect(() => {
    if (projectId === null || !ready) return
    if (projectId === activeId) {
      replaceHash(plain)
      return
    }
    if (inFlight.current === projectId) return
    inFlight.current = projectId
    const { selectProject: select, onSwitching: starting } = callbacks.current
    starting()
    select(projectId).then(
      () => {
        if (inFlight.current === projectId) inFlight.current = null
        replaceHash(plain)
      },
      () => {
        if (inFlight.current === projectId) inFlight.current = null
        replaceHash(unavailableHash('project'))
      }
    )
  }, [projectId, activeId, ready, plain])

  return projectId !== null && ready && projectId !== activeId
}
