import { useCallback, useEffect, useState } from 'react'
import type { GridViewState, SavedGridView } from '@shared/domain'
import type { GridViewsAdapter } from '../types'
import { errorText } from '../../components/errorText'

export interface SavedViews {
  views: readonly SavedGridView[]
  error: string | null
  busy: boolean
  save: (id: string | null, name: string, state: GridViewState) => Promise<SavedGridView | null>
  remove: (id: string) => Promise<boolean>
}

/** FR-21.2. Loads a grid's saved views and keeps the list current after each change. */
export function useSavedViews(adapter: GridViewsAdapter | null | undefined): SavedViews {
  const [views, setViews] = useState<readonly SavedGridView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!adapter) return
    let cancelled = false
    adapter.list().then(
      (list) => {
        if (!cancelled) setViews(list)
      },
      (cause: unknown) => {
        if (!cancelled) setError(messageOf(cause, 'Could not load saved views.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [adapter])

  const save = useCallback(
    async (id: string | null, name: string, state: GridViewState) => {
      if (!adapter) return null
      setBusy(true)
      setError(null)
      try {
        const saved = await adapter.save(id, name, state)
        setViews((current) =>
          current.some((view) => view.id === saved.id)
            ? current.map((view) => (view.id === saved.id ? saved : view))
            : [...current, saved]
        )
        return saved
      } catch (cause) {
        setError(messageOf(cause, 'Could not save the view.'))
        return null
      } finally {
        setBusy(false)
      }
    },
    [adapter]
  )

  const remove = useCallback(
    async (id: string) => {
      if (!adapter) return false
      setBusy(true)
      setError(null)
      try {
        await adapter.remove(id)
        setViews((current) => current.filter((view) => view.id !== id))
        return true
      } catch (cause) {
        setError(messageOf(cause, 'Could not delete the view.'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [adapter]
  )

  return { views, error, busy, save, remove }
}

/** IPC errors read "channel: reason". Show the reason. */
export function messageOf(cause: unknown, fallback: string): string {
  return errorText(cause, fallback)
}
