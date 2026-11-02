import { useCallback, useEffect, useState } from 'react'
import type { FixList, PromptSetView } from '@shared/domain'
import { useChangeVersion } from '../shell/changes'
import { useEngineRevision } from '../shell/engineRevision'
import type { FixesSource } from './client'
import { errorText } from '../components/errorText'

export interface FixesState {
  list: FixList | null
  prompts: PromptSetView | null
  error: string | null
  reload: () => void
  replace: (list: FixList) => void
}

/** Fixes for one page, reloaded when a check, the scheduler or the fix drawer changes them. */
export function useFixes(source: FixesSource, projectId: string, pageId: string): FixesState {
  const revision = useEngineRevision()
  const changes = useChangeVersion('fixes')
  const [list, setList] = useState<FixList | null>(null)
  const [prompts, setPrompts] = useState<PromptSetView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() =>
        Promise.all([
          source['fixes:list']({ projectId, pageId }),
          source['prompts:list']({ projectId, pageId }).catch(() => null)
        ])
      )
      .then(
        ([next, view]) => {
          if (cancelled) return
          setList(next)
          setPrompts(view)
          setError(null)
        },
        (cause: unknown) => {
          if (cancelled) return
          setError(errorText(cause, 'Could not load the fixes.'))
        }
      )
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, revision, reloads, changes])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { list, prompts, error, reload, replace: setList }
}
