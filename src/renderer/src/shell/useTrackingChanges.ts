import { useEffect, useMemo, useState } from 'react'
import type { ProjectIdRequest, TrackingChange, TrackingChangeList } from '@shared/ipc'

/** `tracking:changes` on the preload bridge; tests pass a fake. */
export interface TrackingChangesSource {
  'tracking:changes'(request: ProjectIdRequest): Promise<TrackingChangeList>
}

export function createTrackingChangesSource(): TrackingChangesSource {
  return {
    // Async so a missing bridge (tests, the mock build) rejects instead of throwing.
    'tracking:changes': async (request) => {
      if (typeof window === 'undefined' || !window.citefox) {
        throw new Error('The preload bridge is missing.')
      }
      return window.citefox['tracking:changes'](request)
    }
  }
}

const NONE: readonly TrackingChange[] = []

/**
 * The open project's tracking changes for the charts' grey markers. Read again when
 * the project, the engine revision (a check finished) or the route changes, so a
 * question added on one screen shows on the next chart. A failed read shows none.
 */
export function useTrackingChanges(
  projectId: string | null,
  refreshKey: string,
  source?: TrackingChangesSource
): readonly TrackingChange[] {
  const api = useMemo(() => source ?? createTrackingChangesSource(), [source])
  const [state, setState] = useState<{ projectId: string; changes: readonly TrackingChange[] }>({
    projectId: '',
    changes: NONE
  })
  useEffect(() => {
    if (projectId === null) return undefined
    let live = true
    void Promise.resolve()
      .then(() => api['tracking:changes']({ projectId }))
      .then(
        (list) => {
          if (live) setState({ projectId, changes: list.changes })
        },
        () => {
          if (live) setState({ projectId, changes: NONE })
        }
      )
    return () => {
      live = false
    }
  }, [api, projectId, refreshKey])
  return state.projectId === projectId ? state.changes : NONE
}
