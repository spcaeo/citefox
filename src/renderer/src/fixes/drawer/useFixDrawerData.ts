import { useCallback, useEffect, useState } from 'react'
import type { ProjectFixList, QuestionTargets } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useChangeVersion } from '../../shell/changes'
import type { FixDrawerSource } from './source'

export interface FixDrawerData {
  /** Every fix and open suggestion in the project. */
  list: ProjectFixList
  /** Every page and topic that is not removed, with its markets. */
  targets: QuestionTargets
}

export interface FixDrawerDataState {
  data: FixDrawerData | null
  error: string | null
  reload: () => void
}

/** What the fix drawer reads: the project's fixes and the pages and topics to pick from. */
export function useFixDrawerData(source: FixDrawerSource, projectId: string): FixDrawerDataState {
  const [data, setData] = useState<FixDrawerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  // A save anywhere (this drawer, the Fixes screen) reloads what the drawer shows.
  const changes = useChangeVersion('fixes')

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() =>
        Promise.all([
          source['fixes:listProject']({ projectId }),
          source['prompts:addTargets']({ projectId })
        ])
      )
      .then(
        ([list, targets]) => {
          if (!live) return
          setData({ list, targets })
          setError(null)
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not load the fixes.'))
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, reloads, changes])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { data, error, reload }
}
