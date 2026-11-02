import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineId, Market } from '@shared/domain'
import type { CheckJob } from '@shared/ipc'
import { checkError, checkStartMessage } from '../../m3/source'
import { plainMarket } from './model'
import type { PromptEditSource } from './source'

/** The latest `checks:progress` totals of the re-check job. */
export interface RecheckProgress {
  done: number
  total: number
  searchesUsed: number
  searchesMax: number
  detail: string
}

export type RecheckState =
  | { status: 'idle' }
  | { status: 'running'; promptId: string; markets: string; progress: RecheckProgress | null }
  | { status: 'done'; promptId: string; markets: string; searchesUsed: number }
  | { status: 'error'; message: string }

/**
 * Re-checks one prompt in the picked markets with `checks:start` (a follow-up job,
 * stored as partial) and follows `checks:progress` for it. `checks:start` resolves
 * when the job ends; a refused job (no key, cap reached) comes back with its reason.
 */
export function usePromptRecheck(
  source: PromptEditSource,
  projectId: string,
  pageId: string
): {
  state: RecheckState
  /** The finished job, or null when it did not finish (the state says why). */
  start: (
    promptId: string,
    markets: readonly Market[],
    engines?: readonly EngineId[] | null
  ) => Promise<CheckJob | null>
  fail: (message: string) => void
  dismiss: () => void
} {
  const [state, setState] = useState<RecheckState>({ status: 'idle' })
  const running = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const update = useCallback((next: RecheckState | ((shown: RecheckState) => RecheckState)) => {
    if (mounted.current) setState(next)
  }, [])

  const start = useCallback(
    async (
      promptId: string,
      markets: readonly Market[],
      engines: readonly EngineId[] | null = null
    ): Promise<CheckJob | null> => {
      if (running.current || markets.length === 0) return null
      running.current = true
      const names = markets.map(plainMarket).join(', ')
      update({ status: 'running', promptId, markets: names, progress: null })
      const stop = source['checks:progress']((event) => {
        if (event.projectId !== projectId || event.pageId !== pageId) return
        if (event.promptId !== null && event.promptId !== promptId) return
        update((shown) =>
          shown.status === 'running' && shown.promptId === promptId
            ? {
                ...shown,
                progress: {
                  done: event.done,
                  total: event.total,
                  searchesUsed: event.searchesUsed,
                  searchesMax: event.searchesMax,
                  detail: event.detail
                }
              }
            : shown
        )
      })
      try {
        const job = await source['checks:start']({
          projectId,
          pageIds: [pageId],
          marketIds: markets.map((market) => market.id),
          promptIds: [promptId],
          ...(engines !== null && engines.length > 0 ? { engines } : {})
        })
        if (job.status !== 'finished') {
          update({ status: 'error', message: checkStartMessage(job) })
          return null
        }
        update({ status: 'done', promptId, markets: names, searchesUsed: job.searchesUsed })
        return job
      } catch (cause) {
        update({ status: 'error', message: checkError(cause, 'Could not start the check.') })
        return null
      } finally {
        stop()
        running.current = false
      }
    },
    [source, projectId, pageId, update]
  )

  return {
    state,
    start,
    fail: (message) => update({ status: 'error', message }),
    dismiss: () => update({ status: 'idle' })
  }
}
