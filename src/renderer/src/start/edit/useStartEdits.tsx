import { useCallback, useState, type JSX } from 'react'
import type {
  SiteStartPlan,
  StartEdit,
  StartEditRecord,
  StartEditResult,
  StartProgress
} from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { recordActivity } from '../activity'
import type { StartClient } from '../client'
import { UndoToast } from './UndoToast'

interface Toast {
  record: StartEditRecord
  message: string
  effect: string | null
  /** False after an undo: the toast only reports it. */
  undoable: boolean
}

export interface StartEdits {
  /** Sends one edit; resolves with the result, or null when it failed (the error is shown). */
  send: (edit: StartEdit) => Promise<StartEditResult | null>
  /** The toast with Undo, or null. */
  toast: JSX.Element | null
  error: string | null
  busy: boolean
}

/**
 * Sends journey edits (`start:edit`), shows the Undo toast, undoes
 * (`start:undo`), applies the returned plan and live snapshot, and records each
 * edit and undo in the Activity feed.
 */
export function useStartEdits({
  client,
  projectId,
  onPlan,
  onProgress
}: {
  client: StartClient
  projectId: string
  onPlan?: (plan: SiteStartPlan) => void
  onProgress?: (progress: StartProgress) => void
}): StartEdits {
  const [toast, setToast] = useState<Toast | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [undoing, setUndoing] = useState(false)

  const apply = useCallback(
    (result: StartEditResult) => {
      if (result.plan) onPlan?.(result.plan)
      if (result.progress) onProgress?.(result.progress)
    },
    [onPlan, onProgress]
  )

  const send = useCallback(
    async (edit: StartEdit): Promise<StartEditResult | null> => {
      setBusy(true)
      setError(null)
      try {
        const result = await client.edit({ projectId, edit })
        apply(result)
        record(result.record, result.record.summary, result.effect)
        setToast({
          record: result.record,
          message: result.record.summary,
          effect: result.effect,
          undoable: true
        })
        return result
      } catch (cause) {
        setError(errorText(cause, 'Could not save that change.'))
        return null
      } finally {
        setBusy(false)
      }
    },
    [client, projectId, apply]
  )

  const undo = useCallback(
    async (target: StartEditRecord) => {
      setUndoing(true)
      setError(null)
      try {
        const result = await client.undo({ projectId, editId: target.id })
        apply(result)
        const message = `Undid: ${target.summary}`
        record(result.record, message, result.effect)
        setToast({ record: result.record, message, effect: result.effect, undoable: false })
      } catch (cause) {
        setError(errorText(cause, 'Could not undo that change.'))
      } finally {
        setUndoing(false)
      }
    },
    [client, projectId, apply]
  )

  const close = useCallback(() => setToast(null), [])

  return {
    send,
    error,
    busy,
    toast: toast ? (
      <UndoToast
        key={`${toast.record.id}:${toast.undoable ? 'edit' : 'undo'}`}
        message={toast.message}
        effect={toast.effect}
        undoing={undoing}
        onUndo={toast.undoable ? () => void undo(toast.record) : null}
        onClose={close}
      />
    ) : null
  }
}

function record(entry: StartEditRecord, text: string, effect: string | null): void {
  recordActivity({
    key: `edit:${entry.id}:${text}`,
    at: Date.now(),
    area: 'Setup',
    text: effect ? `${text} · ${effect}` : text,
    state: 'ok'
  })
}
