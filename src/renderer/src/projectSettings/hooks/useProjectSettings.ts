import { useCallback, useEffect, useState } from 'react'
import type { ProjectSettingsView } from '@shared/ipc'
import type { AdminClient } from '../../admin/client'
import { errorText } from '../utils/model'

/** Loads `projectSettings:get` for one project and re-reads it on demand. */
export function useProjectSettings(
  admin: AdminClient,
  projectId: string | null
): {
  view: ProjectSettingsView | null
  error: string | null
  reload: () => Promise<void>
} {
  const [view, setView] = useState<ProjectSettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const read = useCallback(
    (apply: (next: ProjectSettingsView | null, problem: string | null) => void): Promise<void> => {
      if (projectId === null) return Promise.resolve()
      return admin.getProjectSettings({ projectId }).then(
        (next) => apply(next, null),
        (cause: unknown) => apply(null, errorText(cause, 'Could not load the project settings.'))
      )
    },
    [admin, projectId]
  )

  const reload = useCallback(
    () =>
      read((next, problem) => {
        if (next !== null) setView(next)
        setError(problem)
      }),
    [read]
  )

  useEffect(() => {
    let cancelled = false
    void read((next, problem) => {
      if (cancelled) return
      if (next !== null) setView(next)
      setError(problem)
    })
    return () => {
      cancelled = true
    }
  }, [read])

  return { view, error, reload }
}
