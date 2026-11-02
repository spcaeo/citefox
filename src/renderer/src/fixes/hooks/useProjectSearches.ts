import { useCallback, useEffect, useState } from 'react'
import type { ProjectSearches } from '@shared/page-fixes'
import { errorText } from '../../components/errorText'
import { useChangeVersion } from '../../shell/changes'
import { useEngineRevision } from '../../shell/engineRevision'
import { onTopicsChanged } from '../../topics/clusters/events'
import type { ProjectFixesSource } from '../source'

export interface ProjectSearchesState {
  data: ProjectSearches | null
  error: string | null
  reload: () => void
}

/**
 * `fixes:searches`: every search What to fix rolls up. Reloads after a check, when
 * a fix or a topic changes, and on `reload` (after an owner is picked).
 */
export function useProjectSearches(
  source: Pick<ProjectFixesSource, 'fixes:searches'>,
  projectId: string,
  enabled = true
): ProjectSearchesState {
  const revision = useEngineRevision()
  const fixes = useChangeVersion('fixes')
  const [topics, setTopics] = useState(0)
  useEffect(() => onTopicsChanged(() => setTopics((value) => value + 1)), [])
  const [data, setData] = useState<ProjectSearches | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let live = true
    void Promise.resolve()
      .then(() => source['fixes:searches']({ projectId }))
      .then(
        (next) => {
          if (!live) return
          setData(next)
          setError(null)
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not load the searches.'))
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, revision, fixes, topics, reloads, enabled])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { data, error, reload }
}
