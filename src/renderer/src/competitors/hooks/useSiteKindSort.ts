import { useCallback, useEffect, useRef, useState } from 'react'
import { useClaudeGate } from '../../assistant/drawer/model'
import type { CompetitorsSource } from '../source'

/** AI calls per visit at most (40 domains each). */
const MAX_BATCHES = 5

/** Projects whose sort already ran (or failed) in this window, so it runs once a session. */
const attempted = new Set<string>()

/** Test-only: forget which projects were sorted. */
export function resetSiteKindSort(): void {
  attempted.clear()
}

export interface SiteKindSort {
  /** True while the AI sorts the domains no list knows. */
  sorting: boolean
  /** No AI is connected, so the sites stay "Not sorted yet" until one is. */
  needsAi: boolean
  /** Sort the unsorted sites now (the "Sort now" action). */
  sortNow: () => void
}

/**
 * Sorts the cited domains no list knows into kinds of site (`competitors:sortSites`),
 * once per project per session, then reloads the overview. It runs only when an AI
 * is connected: without one the sites stay "Not sorted yet" with a calm line, and
 * nothing is sent. A failure (a bad reply) is not shown as an error either.
 */
export function useSiteKindSort(
  source: CompetitorsSource,
  projectId: string,
  unsorted: number,
  reload: () => void
): SiteKindSort {
  const gate = useClaudeGate()
  const ensure = useRef(gate.ensure)
  useEffect(() => {
    ensure.current = gate.ensure
  }, [gate.ensure])
  const [sorting, setSorting] = useState(false)
  const [needsAi, setNeedsAi] = useState(false)

  const run = useCallback(async (): Promise<void> => {
    if (!(await ensure.current())) {
      setNeedsAi(true)
      return
    }
    setNeedsAi(false)
    setSorting(true)
    let sortedAny = false
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const result = await source['competitors:sortSites']({ projectId })
        if (result.sorted > 0) sortedAny = true
        if (result.remaining === 0 || result.sorted === 0) break
      }
    } catch {
      // Left as "Not sorted yet"; the next session (or Sort now) tries again.
    } finally {
      // Not tied to an effect run: the run that started the sort must finish it,
      // even when a re-render (or Strict Mode) has cleaned the effect up.
      setSorting(false)
      if (sortedAny) reload()
    }
  }, [source, projectId, reload])

  const settled = gate.readiness !== 'checking'
  useEffect(() => {
    if (unsorted === 0 || !settled || attempted.has(projectId)) return
    attempted.add(projectId)
    void Promise.resolve().then(run)
  }, [projectId, unsorted, settled, run])

  const sortNow = useCallback(() => {
    if (!sorting) void run()
  }, [sorting, run])

  return { sorting, needsAi: needsAi || gate.readiness === 'not-ready', sortNow }
}
