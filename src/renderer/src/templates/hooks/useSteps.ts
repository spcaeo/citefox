import { useCallback, useEffect, useState } from 'react'
import type { TemplateStep } from '@shared/ipc'
import type { TemplatesClient } from '../client'
import { readTemplateFailure } from '../name'

export interface StepsState {
  steps: readonly TemplateStep[]
  loading: boolean
  error: string | null
  /** Reloads every step, for example after the app default changed. */
  reload: () => Promise<readonly TemplateStep[]>
  /** Puts one step returned by a save or reset into the list. */
  replace: (step: TemplateStep) => void
}

/** `templates:steps` for the open project, or app templates only when none is open. */
export function useSteps(client: TemplatesClient, projectId: string | null): StepsState {
  const [steps, setSteps] = useState<readonly TemplateStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(
    () => client.steps(projectId ? { projectId } : {}),
    [client, projectId]
  )

  useEffect(() => {
    let cancelled = false
    void request().then(
      (list) => {
        if (cancelled) return
        setSteps(list)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(readTemplateFailure(cause))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [request])

  const reload = useCallback(async () => {
    const list = await request()
    setSteps(list)
    setError(null)
    return list
  }, [request])

  const replace = useCallback((step: TemplateStep) => {
    setSteps((current) => current.map((item) => (item.kind === step.kind ? step : item)))
  }, [])

  return { steps, loading, error, reload, replace }
}
