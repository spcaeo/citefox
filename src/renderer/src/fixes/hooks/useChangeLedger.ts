import { useCallback, useEffect, useState } from 'react'
import type { ChangeLedger } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useChangeVersion } from '../../shell/changes'
import { useEngineRevision } from '../../shell/engineRevision'
import { fixWorkingLine, recordActivity } from '../../start/activity'
import type { ProjectFixesSource } from '../source'

export interface ChangeLedgerState {
  data: ChangeLedger | null
  error: string | null
  reload: () => void
}

/**
 * `fixes:ledger`, reloaded when a check, the scheduler or the fix drawer changes the
 * data and after each action. Nothing loads while `enabled` is false (the Fix log and
 * Lost ground views read their own channels). A fix that turned Worked since the last
 * load ("Fix 2 on /blog/x is working: …") goes to Activity once.
 */
export function useChangeLedger(
  source: ProjectFixesSource,
  projectId: string,
  enabled = true
): ChangeLedgerState {
  const revision = useEngineRevision()
  const changes = useChangeVersion('fixes')
  const [data, setData] = useState<ChangeLedger | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let live = true
    void Promise.resolve()
      .then(() => source['fixes:ledger']({ projectId }))
      .then(
        (next) => {
          if (!live) return
          setData(next)
          setError(null)
          // A fix that turned Worked is said once (main notes it), in Activity.
          for (const note of next.workingNotes ?? []) {
            recordActivity({ ...fixWorkingLine(note), at: Date.now() })
          }
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not load the changes.'))
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, revision, reloads, enabled, changes])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { data, error, reload }
}
