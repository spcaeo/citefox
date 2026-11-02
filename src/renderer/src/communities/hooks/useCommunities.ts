import { useCallback, useEffect, useState } from 'react'
import type { CommunitiesReport, CommunityScope } from '@shared/domain'
import { useEngineRevision } from '../../shell/engineRevision'
import type { CommunitiesSource } from '../source'
import { errorText } from '../utils/errors'

export interface CommunitiesState {
  report: CommunitiesReport | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** Loads `communities:get` for the scope and market, again after each check (engine revision). */
export function useCommunities(
  source: CommunitiesSource,
  request: {
    projectId: string
    scope: CommunityScope
    /** Required for page scope; project scope ignores it (the project screen sends null). */
    pageId: string | null
    marketId: string | null
  }
): CommunitiesState {
  const { projectId, scope, pageId, marketId } = request
  const revision = useEngineRevision()
  const [tick, setTick] = useState(0)
  const key = `${projectId}\0${scope}\0${pageId ?? ''}\0${marketId ?? ''}\0${revision}\0${tick}`
  const [loaded, setLoaded] = useState<{
    key: string
    report: CommunitiesReport | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    // Through a promise, so a missing bridge (thrown, not rejected) shows as the error line.
    void Promise.resolve()
      .then(() => source['communities:get']({ projectId, scope, pageId, marketId }))
      .then(
        (report) => {
          if (!cancelled) setLoaded({ key, report, error: null })
        },
        (cause: unknown) => {
          if (!cancelled) {
            setLoaded({ key, report: null, error: errorText(cause, 'Could not load communities.') })
          }
        }
      )
    return () => {
      cancelled = true
    }
  }, [source, projectId, scope, pageId, marketId, key])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const current = loaded?.key === key ? loaded : null
  return {
    report: current?.report ?? loaded?.report ?? null,
    error: current?.error ?? null,
    loading: current === null,
    reload
  }
}
