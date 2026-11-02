import { useCallback, useEffect, useState } from 'react'
import type { ProjectHistory } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { useEngineRevision } from '../../../shell/engineRevision'
import type { ProjectHistorySource } from '../../client'

export interface ProjectHistoryState {
  data: ProjectHistory | null
  error: string | null
  reload: () => void
}

/**
 * `history:listProject`, reloaded when a check or the scheduler changes the engine's
 * data, so a check that finishes while the screen is open appears without a refresh.
 */
export function useProjectHistory(
  source: ProjectHistorySource,
  projectId: string
): ProjectHistoryState {
  const revision = useEngineRevision()
  const [data, setData] = useState<ProjectHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => source['history:listProject']({ projectId }))
      .then(
        (next) => {
          if (!live) return
          setData(next)
          setError(null)
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not load the check history.'))
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, revision, reloads])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { data, error, reload }
}
