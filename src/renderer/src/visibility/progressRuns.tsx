import { useContext, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { PageResults } from '@shared/domain'
import { DrillContext } from '../drill/context'
import { uniqueIds, type DrillCopy } from './progressDrills'
import {
  requestFix,
  runsDrill,
  RunsContext,
  useProgressRuns,
  type ProgressRuns
} from './progressRunsContext'

export function ProgressRunsProvider({
  value,
  children
}: {
  value: ProgressRuns
  children: ReactNode
}): JSX.Element {
  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>
}

/**
 * Opens the prompts behind a number in one check, loading that check first
 * when it is not loaded yet. With an id list the button carries the NFR-14
 * marks and its figure is the id count, which is the drawer total by
 * construction. With a function (ids known only once the check loads) it
 * carries no marks and must show no count.
 */
export function RunDrillButton({
  copy,
  ids,
  marketId,
  runId,
  label,
  className = 'm3-link',
  style,
  untracked = false,
  children
}: {
  copy: DrillCopy
  ids: readonly string[] | ((results: PageResults) => readonly string[])
  marketId: string | null
  runId: string | null
  /** Accessible name. It must contain the figure when there is one. */
  label?: string
  className?: string
  style?: CSSProperties
  /** No NFR-14 marks: the control shows no count of its own (a verdict word, a score). */
  untracked?: boolean
  children: ReactNode
}): JSX.Element | null {
  const runs = useProgressRuns()
  const drills = useContext(DrillContext)
  const [busy, setBusy] = useState(false)
  if (!runs || !drills)
    return <span className={className === 'm3-link' ? undefined : className}>{children}</span>
  const tracked = typeof ids !== 'function' && !untracked
  async function activate(): Promise<void> {
    if (!runs || !drills) return
    const loaded = runId ? (runs.cached(marketId, runId) ?? null) : null
    let results = loaded
    if (!results && runId) {
      setBusy(true)
      results = await runs.load(marketId, runId)
      setBusy(false)
    }
    const list = typeof ids === 'function' ? (results ? ids(results) : []) : ids
    drills.open(runsDrill(runs, copy, list, marketId, runId, results))
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      aria-busy={busy || undefined}
      data-nfr-drill={tracked ? copy.id : undefined}
      onClick={() => void activate()}
    >
      {children}
    </button>
  )
}

/** The count a `RunDrillButton` shows: the number of distinct ids, marked for NFR-14. */
export function RunFigure({ id, ids }: { id: string; ids: readonly string[] }): JSX.Element {
  return <span data-nfr-figure={id}>{uniqueIds(ids).length}</span>
}

/**
 * "Fix N" that jumps to the fix card on this tab. A button, not a hash link,
 * because the hash is the route.
 */
export function FixJump({
  number,
  className = 'm3-link',
  label,
  children
}: {
  number: number
  className?: string
  label?: string
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className={className}
      aria-label={label ?? `Go to Fix ${number}`}
      onClick={() => requestFix(number)}
    >
      {children}
    </button>
  )
}
