import { useEffect, useState } from 'react'
import type { LoggedFix } from '@shared/domain'
import type { CreateFixRequest, QuestionTarget } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { notifyChanged, useChangeVersion } from '../../shell/changes'
import { showUndo } from '../../ui'
import type { ProjectFixesSource } from '../source'
import { publishedFixOf } from './publish'

type PublishSource = Pick<
  ProjectFixesSource,
  'fixes:listProject' | 'fixes:create' | 'fixes:delete' | 'prompts:addTargets'
>

export interface PublishState {
  /** The fix logged from this page fix (newest), or null. */
  published: LoggedFix | null
  /** Pages and topics to store it on, with their markets. Null while loading. */
  targets: readonly QuestionTarget[] | null
  busy: boolean
  error: string | null
  /** Logs the fix, shows the Undo toast, and the drawer turns to "Live since". */
  publish: (request: CreateFixRequest) => void
}

/**
 * "I published this": the page fix's logged fix (read from `fixes:listProject`, so it
 * shows wherever the drawer opens), the pages and topics it can be stored on, and the
 * one-click log with Undo (about ten seconds, `showUndo`).
 */
export function usePublish(
  source: PublishSource,
  projectId: string,
  pageFixId: string
): PublishState {
  const changes = useChangeVersion('fixes')
  const [published, setPublished] = useState<LoggedFix | null>(null)
  const [targets, setTargets] = useState<readonly QuestionTarget[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        ([list, found]) => {
          if (!live) return
          setPublished(publishedFixOf(pageFixId, list.fixes))
          setTargets(found.targets)
        },
        () => {
          if (live) setTargets((current) => current ?? [])
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, pageFixId, changes])

  function publish(request: CreateFixRequest): void {
    setBusy(true)
    setError(null)
    void Promise.resolve()
      .then(() => source['fixes:create'](request))
      .then(
        (saved) => {
          setPublished(saved)
          setBusy(false)
          notifyChanged('fixes')
          showUndo({
            message: `Logged Fix ${saved.number} as live today.`,
            effect: 'CiteFox measures its searches from the next check.',
            undo: async () => {
              await source['fixes:delete']({ projectId, fixId: saved.id })
              setPublished(null)
              notifyChanged('fixes')
            }
          })
        },
        (cause: unknown) => {
          setBusy(false)
          setError(errorText(cause, 'Could not log the fix.'))
        }
      )
  }

  return { published, targets, busy, error, publish }
}
