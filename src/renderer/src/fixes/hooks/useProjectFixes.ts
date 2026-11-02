import { useCallback, useEffect, useState } from 'react'
import type { ProjectFixList } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useChangeVersion } from '../../shell/changes'
import { useEngineRevision } from '../../shell/engineRevision'
import type { ProjectFixesSource } from '../source'

export interface ProjectFixesState {
  data: ProjectFixList | null
  error: string | null
  reload: () => void
}

/** `fixes:listProject`, reloaded when a check, the scheduler or a fix drawer changes the data. */
export function useProjectFixes(source: ProjectFixesSource, projectId: string): ProjectFixesState {
  const revision = useEngineRevision()
  const changes = useChangeVersion('fixes')
  const [data, setData] = useState<ProjectFixList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => source['fixes:listProject']({ projectId }))
      .then(
        (next) => {
          if (!live) return
          setData(next)
          setError(null)
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not load the fixes.'))
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, revision, reloads, changes])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { data, error, reload }
}
