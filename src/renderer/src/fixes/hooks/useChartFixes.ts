import { useEffect, useMemo, useState } from 'react'
import type { ProjectFixList } from '@shared/ipc'
import { useChangeVersion } from '../../shell/changes'
import { useEngineRevision } from '../../shell/engineRevision'
import { createProjectFixesSource, type ProjectFixesSource } from '../source'

/**
 * Every logged fix of the project, for the markers under a chart (`fixes:listProject`).
 * Null while loading or when it can't be read: the chart then shows no fix markers
 * and never an error. Reloads after a check and when fixes change.
 */
export function useChartFixes(
  projectId: string | null,
  source?: Pick<ProjectFixesSource, 'fixes:listProject'>
): ProjectFixList | null {
  const resolved = useMemo(() => source ?? createProjectFixesSource(), [source])
  const revision = useEngineRevision()
  const changes = useChangeVersion('fixes')
  const [state, setState] = useState<ProjectFixList | null>(null)

  useEffect(() => {
    if (!projectId) return undefined
    let live = true
    void Promise.resolve()
      .then(() => resolved['fixes:listProject']({ projectId }))
      .then(
        (list) => {
          if (live) setState(list)
        },
        () => {
          // No markers rather than an error: the chart stands on its own.
        }
      )
    return () => {
      live = false
    }
  }, [resolved, projectId, revision, changes])

  return state && state.projectId === projectId ? state : null
}
