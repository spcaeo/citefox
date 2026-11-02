import { useCallback, useEffect, useState } from 'react'
import type { StructureView } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useEngineRevision } from '../../shell/engineRevision'
import { notifyPagesChanged, usePagesRevision } from './changes'

export interface MembersState<Row> {
  view: StructureView | null
  rows: readonly Row[] | null
  error: string | null
  reload: () => void
  /** Runs one change, then reloads this drawer and the screen under it. Resolves the result, or null. */
  act: <T>(label: string, call: () => Promise<T>) => Promise<T | null>
  busy: string | null
  /** The last action's failure, in plain words. */
  actionError: string | null
}

/**
 * The structure view plus one cluster's or group's pages, reloaded after each
 * change made here or in a drawer stacked on top (`notifyPagesChanged`).
 */
export function useMembers<Row>(
  loadView: () => Promise<StructureView>,
  loadRows: () => Promise<readonly Row[]>,
  key: string
): MembersState<Row> {
  const engine = useEngineRevision()
  const changes = usePagesRevision()
  const [loaded, setLoaded] = useState<{
    key: string
    view: StructureView
    rows: readonly Row[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([loadView(), loadRows()]).then(
      ([view, rows]) => {
        if (!live) return
        setLoaded({ key, view, rows })
        setError(null)
      },
      (cause: unknown) => {
        if (live) setError(errorText(cause, 'Could not load these pages.'))
      }
    )
    return () => {
      live = false
    }
    // The loaders change with `key`; the revisions reload in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, engine, changes, tries])

  const reload = useCallback(() => setTries((value) => value + 1), [])

  const act = useCallback(async <T>(label: string, call: () => Promise<T>): Promise<T | null> => {
    setBusy(label)
    setActionError(null)
    try {
      const result = await call()
      notifyPagesChanged()
      return result
    } catch (cause) {
      setActionError(errorText(cause, `${label} did not finish. Try again.`))
      return null
    } finally {
      setBusy(null)
    }
  }, [])

  const mine = loaded !== null && loaded.key === key ? loaded : null
  return {
    view: mine?.view ?? null,
    rows: mine?.rows ?? null,
    error,
    reload,
    act,
    busy,
    actionError
  }
}
