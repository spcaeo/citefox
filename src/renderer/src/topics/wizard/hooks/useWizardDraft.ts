import { useCallback, useEffect, useRef, useState } from 'react'
import type { TopicDraft } from '@shared/domain'
import type { TopicDraftPatch } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import type { TopicsClient } from '../client'
import { localId } from '../utils/draft'
import { applyPatch, mergePatch } from '../utils/patch'

export const SAVE_DELAY_MS = 400

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface WizardDraftState {
  draft: TopicDraft | null
  loading: boolean
  loadError: string | null
  saveState: SaveState
  saveError: string | null
  /** Changes the draft on screen now and saves the patch shortly after. */
  patch: (patch: TopicDraftPatch) => void
  /** Takes a draft a Claude step returned; edits not saved yet stay on top. */
  replace: (draft: TopicDraft) => void
  /** Saves any pending patch now and resolves to the saved draft. */
  flush: () => Promise<TopicDraft | null>
  reload: () => void
}

function apply(draft: TopicDraft, patch: TopicDraftPatch): TopicDraft {
  return applyPatch(draft, patch, { now: new Date().toISOString(), makeId: localId })
}

/**
 * Loads one draft and keeps it saved through `topics:updateDraft`, so the
 * wizard survives a restart. Edits show at once (applied locally the way main
 * applies them); patches are merged and sent after a short pause, and the
 * saved draft main returns becomes the base, with any newer edits on top.
 */
export function useWizardDraft(
  client: TopicsClient,
  projectId: string | null,
  draftId: string | null
): WizardDraftState {
  const [draft, setDraft] = useState<TopicDraft | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Which load finished last, and how. `loading` is true until it matches the current key.
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null)
  const latest = useRef<TopicDraft | null>(null)
  const pending = useRef<TopicDraftPatch | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<TopicDraft | null> | null>(null)
  const key = projectId && draftId ? `${projectId}\n${draftId}\n${attempt}` : null
  const loading = key !== null && settled?.key !== key
  const loadError = key !== null && settled?.key === key ? settled.error : null

  useEffect(() => {
    if (!projectId || !draftId || key === null) return
    let cancelled = false
    client['topics:getDraft']({ projectId, draftId }).then(
      (loaded) => {
        if (cancelled) return
        latest.current = loaded
        pending.current = null
        setDraft(loaded)
        setSettled({ key, error: null })
      },
      (error: unknown) => {
        if (cancelled) return
        setSettled({ key, error: errorText(error, 'Could not open this draft.') })
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, draftId, key])

  const show = useCallback((next: TopicDraft) => {
    latest.current = next
    setDraft(next)
  }, [])

  const save = useCallback(async (): Promise<TopicDraft | null> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inflight.current) await inflight.current
    const send = pending.current
    if (!send || !projectId || !draftId) return latest.current
    pending.current = null
    setSaveState('saving')
    const run = client['topics:updateDraft']({ projectId, draftId, patch: send }).then(
      (saved) => {
        const newer = pending.current
        show(newer ? apply(saved, newer) : saved)
        setSaveState('saved')
        setSaveError(null)
        return saved
      },
      (error: unknown) => {
        pending.current = pending.current ? mergePatch(send, pending.current) : send
        setSaveState('error')
        setSaveError(errorText(error, 'Could not save the draft.'))
        return latest.current
      }
    )
    inflight.current = run
    try {
      return await run
    } finally {
      inflight.current = null
    }
  }, [client, projectId, draftId, show])

  const patch = useCallback(
    (change: TopicDraftPatch) => {
      const current = latest.current
      if (!current) return
      show(apply(current, change))
      pending.current = pending.current ? mergePatch(pending.current, change) : change
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
    },
    [save, show]
  )

  const replace = useCallback(
    (next: TopicDraft) => {
      const newer = pending.current
      show(newer ? apply(next, newer) : next)
    },
    [show]
  )

  // Send what is pending when the wizard closes.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      const send = pending.current
      if (send && projectId && draftId) {
        pending.current = null
        void client['topics:updateDraft']({ projectId, draftId, patch: send }).catch(
          () => undefined
        )
      }
    },
    [client, projectId, draftId]
  )

  return {
    draft,
    loading,
    loadError,
    saveState,
    saveError,
    patch,
    replace,
    flush: save,
    reload: () => setAttempt((n) => n + 1)
  }
}
