import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PageChangeList } from '@shared/ipc'
import { useChangeVersion } from '../shell/changes'
import { useEngineRevision } from '../shell/engineRevision'
import type { ChartEvent } from '../ui'
import { errorText } from '../components/errorText'
import { pageChangeActions, type PageChangeActions } from './actions'
import { createPageChangesSource, type PageChangesSource } from './client'
import { pageChangeEvents } from './model'

export interface PageChangesState {
  list: PageChangeList | null
  error: string | null
  reload: () => void
}

/**
 * The project's page changes (`pageChanges:list`). Reloads after a check, when a
 * change is decided, and when fixes change (a new fix can link a change).
 */
export function usePageChanges(
  projectId: string | null,
  source?: Pick<PageChangesSource, 'pageChanges:list'>
): PageChangesState {
  const resolved = useMemo(() => source ?? createPageChangesSource(), [source])
  const revision = useEngineRevision()
  const decided = useChangeVersion('pageChanges')
  const fixes = useChangeVersion('fixes')
  const [reloads, setReloads] = useState(0)
  const [state, setState] = useState<{ list: PageChangeList | null; error: string | null }>({
    list: null,
    error: null
  })

  useEffect(() => {
    if (!projectId) return undefined
    let live = true
    void Promise.resolve()
      .then(() => resolved['pageChanges:list']({ projectId }))
      .then(
        (list) => {
          if (live) setState({ list, error: null })
        },
        (cause: unknown) => {
          if (live)
            setState({ list: null, error: errorText(cause, 'Could not load page changes.') })
        }
      )
    return () => {
      live = false
    }
  }, [resolved, projectId, revision, decided, fixes, reloads])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  const list = state.list && state.list.projectId === projectId ? state.list : null
  return { list, error: state.error, reload }
}

/** The "?" markers for a chart: changes nobody logged on these pages (null: every page). */
export function usePageChangeEvents(
  projectId: string | null,
  pageIds: ReadonlySet<string> | null
): ChartEvent[] {
  const { list } = usePageChanges(projectId)
  return useMemo(() => pageChangeEvents(list?.changes ?? [], pageIds), [list, pageIds])
}

/** Log as fix, See what changed, Not a fix (with Undo) for one project. */
export function usePageChangeActions(
  projectId: string,
  source?: PageChangesSource
): PageChangeActions {
  const resolved = useMemo(() => source ?? createPageChangesSource(), [source])
  return useMemo(() => pageChangeActions(resolved, projectId), [resolved, projectId])
}
