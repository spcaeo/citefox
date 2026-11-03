import { useCallback, useEffect, useRef, useState } from 'react'
import type { QuestionsDraft, QuestionsDraftRow, SaveQuestionsDraftRequest } from '@shared/ipc'
import type { AddQuestionsSource } from '../source'
import type { DraftRow } from '../types'
import { isBlank } from '../utils/rows'

/** Wait after the last change before the rows are saved to main. */
export const DRAFT_SAVE_DELAY_MS = 400
/** Wait before a failed save is tried again. */
export const DRAFT_RETRY_DELAY_MS = 3000

/**
 * Add questions' unsaved rows, kept in main until they are added or discarded
 * (W3I-C4), so a reload or a restart does not lose them. Opening the drawer
 * offers a saved draft ("Continue" or "Discard"); nothing is saved over it until
 * one is picked. After that every change is saved a moment after the last one,
 * and once more when the drawer goes away.
 */

export interface DraftSnapshot {
  targetId: string | null
  defaultPage: string | null
  rows: readonly DraftRow[]
}

export interface QuestionsDraftState {
  /** A saved draft waiting for Continue or Discard. */
  offer: QuestionsDraft | null
  /** Takes the offered draft (its rows go back into the grid). */
  take: () => QuestionsDraft | null
  /** Throws the offered draft away. */
  discard: () => void
  /** The rows were added or discarded: forget the draft and save nothing more. */
  clear: () => void
  /** The last save failed; it is tried again soon. */
  saveFailed: boolean
}

type Phase = 'loading' | 'offer' | 'free' | 'done'

export function draftRows(rows: readonly DraftRow[]): QuestionsDraftRow[] {
  return rows
    .filter((row) => !isBlank(row))
    .map((row) => ({
      question: row.question,
      stage: row.stage,
      page: row.page,
      market: row.market,
      tags: row.tags,
      topic: row.topic,
      createTopic: row.createTopic,
      addMarket: row.addMarket,
      keep: row.keep,
      origin: row.origin
    }))
}

export function useQuestionsDraft(
  source: AddQuestionsSource,
  projectId: string,
  snapshot: DraftSnapshot
): QuestionsDraftState {
  const [status, setStatus] = useState<{
    projectId: string
    phase: Phase
    offer: QuestionsDraft | null
  }>({ projectId, phase: 'loading', offer: null })
  const phase: Phase = status.projectId === projectId ? status.phase : 'loading'
  const offer = status.projectId === projectId ? status.offer : null
  const saved = useRef('')
  const mounted = useRef(true)
  const retryTimer = useRef<number | null>(null)
  const [retry, setRetry] = useState(0)
  const [saveFailed, setSaveFailed] = useState(false)
  const pending = useRef<(() => void) | null>(null)
  const phaseNow = useRef<Phase>(phase)
  useEffect(() => {
    phaseNow.current = phase
  }, [phase])

  useEffect(() => {
    let live = true
    const get = source['import:getDraft']
    void Promise.resolve(get ? get({ projectId }) : null)
      .catch(() => null)
      .then((draft) => {
        if (!live) return
        const found = draft !== null && draft.rows.length > 0
        setStatus({ projectId, phase: found ? 'offer' : 'free', offer: found ? draft : null })
      })
    return () => {
      live = false
    }
  }, [source, projectId])

  const rows = draftRows(snapshot.rows)
  const text = JSON.stringify({
    projectId,
    targetId: snapshot.targetId,
    defaultPage: snapshot.defaultPage,
    rows
  })
  const free = phase === 'free'
  const empty = rows.length === 0

  useEffect(() => {
    const save = source['import:saveDraft']
    pending.current = null
    if (!free || !save || text === saved.current) return
    // Nothing typed yet and nothing saved: no file to write.
    if (saved.current === '' && empty) return
    const send = (): void => {
      pending.current = null
      // Only a save that went through counts as saved; a failed one stays dirty and is retried.
      void Promise.resolve()
        .then(() => save(JSON.parse(text) as SaveQuestionsDraftRequest))
        .then(
          () => {
            saved.current = text
            if (mounted.current) setSaveFailed(false)
          },
          () => {
            if (!mounted.current || phaseNow.current !== 'free') return
            setSaveFailed(true)
            if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
            retryTimer.current = window.setTimeout(() => {
              retryTimer.current = null
              setRetry((value) => value + 1)
            }, DRAFT_RETRY_DELAY_MS)
          }
        )
    }
    pending.current = send
    const timer = window.setTimeout(send, DRAFT_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [source, free, text, empty, retry])

  // The drawer going away (Back, a link elsewhere) saves the last change at once.
  useEffect(() => {
    mounted.current = true
    return () => {
      if (phaseNow.current === 'free') pending.current?.()
      mounted.current = false
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    }
  }, [])

  const take = useCallback((): QuestionsDraft | null => {
    setStatus({ projectId, phase: 'free', offer: null })
    return offer
  }, [offer, projectId])

  const discard = useCallback(() => {
    saved.current = ''
    setStatus({ projectId, phase: 'free', offer: null })
    void source['import:clearDraft']?.({ projectId }).catch(() => undefined)
  }, [source, projectId])

  const clear = useCallback(() => {
    // An offer nobody answered stays for next time.
    if (phaseNow.current === 'offer') return
    pending.current = null
    phaseNow.current = 'done'
    setStatus({ projectId, phase: 'done', offer: null })
    void source['import:clearDraft']?.({ projectId }).catch(() => undefined)
  }, [source, projectId])

  return { offer, take, discard, clear, saveFailed }
}
