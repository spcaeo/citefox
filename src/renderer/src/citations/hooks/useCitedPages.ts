import { useCallback, useEffect, useState } from 'react'
import type { CitedPagesData } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useChangeVersion } from '../../shell/changes'
import { useEngineRevision } from '../../shell/engineRevision'
import type { CitationsSource } from '../source'

export interface CitedPagesState {
  /** The last loaded list, kept while the next one loads. */
  data: CitedPagesData | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** `allpages:citedPages`, reloaded when a check finishes or a competitor changes. */
export function useCitedPages(source: CitationsSource, projectId: string): CitedPagesState {
  const revision = useEngineRevision()
  const changes = useChangeVersion('competitors')
  const [data, setData] = useState<CitedPagesData | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const key = `${projectId}\0${revision}\0${changes}\0${reloads}`

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => source['allpages:citedPages']({ projectId }))
      .then(
        (next) => {
          if (!live) return
          setData(next)
          setError(null)
          setLoadedKey(key)
        },
        (cause: unknown) => {
          if (!live) return
          setError(errorText(cause, 'Could not load the cited pages.'))
          setLoadedKey(key)
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, key])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { data, loading: loadedKey !== key, error: loadedKey === key ? error : null, reload }
}
