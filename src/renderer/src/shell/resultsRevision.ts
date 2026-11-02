import { useEffect, useState } from 'react'
import type { ResultsChanged } from '@shared/ipc'

/** At most one re-read per second while answers come in (owner: "show that in background"). */
export const RESULTS_CHANGED_DELAY_MS = 1000

export type ResultsChangedSubscribe = (listener: (event: ResultsChanged) => void) => () => void

/** The preload's `results:changed`, or nothing outside the app (mock builds, most tests). */
export function bridgeSubscribe(listener: (event: ResultsChanged) => void): () => void {
  const api = typeof window === 'undefined' ? undefined : window.citefox
  const on = api?.['results:changed']
  return typeof on === 'function' ? on(listener) : () => undefined
}

/**
 * Goes up when a running check saves a result this screen shows: one project, and one
 * page or topic when `pageId` is given. Answers coming in are batched to one re-read a
 * second; the end of a check re-reads at once, so "Checked just now" shows straight away.
 * Screens list it as an effect dependency, like the engine revision.
 */
export function useResultsRevision(options: {
  projectId: string
  pageId?: string | null
  subscribe?: ResultsChangedSubscribe
  delayMs?: number
}): number {
  const { projectId, pageId = null, subscribe = bridgeSubscribe } = options
  const delayMs = options.delayMs ?? RESULTS_CHANGED_DELAY_MS
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      setRevision((current) => current + 1)
    }
    const stop = subscribe((event) => {
      if (event.projectId !== projectId) return
      if (pageId !== null && event.pageId !== pageId) return
      if (event.state !== 'running') {
        bump()
        return
      }
      // The first answer of a burst starts the clock; later ones ride along.
      if (timer === null) timer = setTimeout(bump, delayMs)
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      stop()
    }
  }, [projectId, pageId, subscribe, delayMs])
  return revision
}
