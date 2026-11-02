import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { Market, PageResults } from '@shared/domain'
import type { DrillRequest } from '../drill'
import { marketLabel } from '../shell/model'
import { runIdsDrill, type DrillCopy, type PromptMeta } from './progressDrills'

/**
 * The checks Progress has loaded, and a loader for the rest (other markets,
 * a fix's follow-up in another market). Drills read rows from the check a
 * number belongs to, never from "the latest" by default.
 */
export interface ProgressRuns {
  pageId: string
  /** The market this tab shows (its checks are already loaded). */
  marketId: string | null
  meta: ReadonlyMap<string, PromptMeta>
  /** Such as "🇺🇸 US · EN". */
  placeOf: (marketId: string | null) => string
  /** A loaded check, or undefined. */
  cached: (marketId: string | null, runId: string) => PageResults | undefined
  /** Loads a check (`results:get` with that market and run). Null when it fails. */
  load: (marketId: string | null, runId: string) => Promise<PageResults | null>
}

export const RunsContext = createContext<ProgressRuns | null>(null)

/** The nearest Progress runs, or null outside the Progress tab (drills then render as text). */
export function useProgressRuns(): ProgressRuns | null {
  return useContext(RunsContext)
}

/** Builds the runs value: this market's loaded checks plus a per-run cache for the rest. */
export function useRunsValue({
  pageId,
  marketId,
  markets,
  place,
  runs,
  meta,
  fetchRun
}: {
  pageId: string
  marketId: string | null
  markets: readonly Market[]
  place: string
  runs: ReadonlyMap<string, PageResults>
  meta: ReadonlyMap<string, PromptMeta>
  fetchRun: (marketId: string | null, runId: string) => Promise<PageResults>
}): ProgressRuns {
  const cache = useRef(new Map<string, PageResults>())
  const [, setVersion] = useState(0)
  const own = useCallback(
    (id: string | null) => id === null || id === '' || id === marketId,
    [marketId]
  )
  const cached = useCallback(
    (id: string | null, runId: string): PageResults | undefined =>
      (own(id) ? runs.get(runId) : undefined) ?? cache.current.get(`${id ?? ''}\0${runId}`),
    [own, runs]
  )
  const load = useCallback(
    async (id: string | null, runId: string): Promise<PageResults | null> => {
      const hit = cached(id, runId)
      if (hit) return hit
      try {
        const results = await fetchRun(id, runId)
        cache.current.set(`${id ?? ''}\0${runId}`, results)
        setVersion((value) => value + 1)
        return results
      } catch {
        return null
      }
    },
    [cached, fetchRun]
  )
  const placeOf = useCallback(
    (id: string | null): string => {
      if (own(id)) return place
      const market = markets.find((item) => item.id === id)
      return market ? marketLabel(market) : 'Another market'
    },
    [markets, own, place]
  )
  return useMemo(
    () => ({ pageId, marketId, meta, placeOf, cached, load }),
    [pageId, marketId, meta, placeOf, cached, load]
  )
}

/** The prompts drill for ids in one check, from what is loaded now. */
export function runsDrill(
  runs: ProgressRuns,
  copy: DrillCopy,
  ids: readonly string[],
  marketId: string | null,
  runId: string | null,
  results?: PageResults | null
): DrillRequest {
  const found = results ?? (runId ? runs.cached(marketId, runId) : undefined)
  return runIdsDrill(copy, ids, found, {
    pageId: runs.pageId,
    marketId: marketId ?? runs.marketId,
    runId,
    marketLabel: runs.placeOf(marketId),
    meta: runs.meta
  })
}

/** The DOM id of a fix card, the target of every "Fix N" reference on Progress. */
export function fixAnchorId(number: number): string {
  return `fix-${number}`
}

/** Event Progress listens for: show Fix N (the Fixes tab and that fix's detail). */
export const PROGRESS_FIX_EVENT = 'citefox:progress-fix'

/**
 * Asks Progress to show Fix N: it opens the Fixes tab, picks that fix, then
 * focuses its card. Every "Fix N" reference on Progress uses this.
 */
export function requestFix(number: number): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<number>(PROGRESS_FIX_EVENT, { detail: number }))
}

/** Scrolls a fix card into view and moves focus to it. False when it is not on screen. */
export function focusFix(number: number): boolean {
  if (typeof document === 'undefined') return false
  const card = document.getElementById(fixAnchorId(number))
  if (!card) return false
  if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'start' })
  card.focus({ preventScroll: true })
  return true
}
