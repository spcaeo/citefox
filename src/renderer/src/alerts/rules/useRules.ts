import { useCallback, useEffect, useState } from 'react'
import type { AlertRule } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import type { RulesClient } from './rulesClient'

export interface RulesState {
  /** Null while loading (and after a failed first load). */
  rules: readonly AlertRule[] | null
  slackReady: boolean
  error: string | null
  reload: () => void
}

/** The project's alert rules, reloaded after every change. */
export function useRules(client: RulesClient, projectId: string | null): RulesState {
  const [rules, setRules] = useState<readonly AlertRule[] | null>(null)
  const [slackReady, setSlackReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (projectId === null) return
    let live = true
    client.list(projectId).then(
      (list) => {
        if (!live) return
        setRules(list.rules)
        setSlackReady(list.slackReady)
        setError(null)
      },
      (cause: unknown) => {
        if (live) setError(errorText(cause, 'Could not load the alert rules.'))
      }
    )
    return () => {
      live = false
    }
  }, [client, projectId, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { rules, slackReady, error, reload }
}
