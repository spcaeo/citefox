import { useEffect, useState } from 'react'
import { ENGINE_SHORT_LABEL, type EngineId } from '@shared/domain'
import type { CheckInFlightItem } from '@shared/ipc'
import { promptLabel } from '../model/scoring'
import type { TopicResultsSource } from '../source'
import type { TopicResultRow } from '../types'

/**
 * The questions of this topic a running check is on now, from `checks:progress`
 * (owner, 2026-10-29: "if there are three processes, why don't we show these three?").
 * Empty when no check runs, before its first push, or when the source has no progress.
 */
export function useCheckInFlight(options: {
  source: TopicResultsSource
  /** The running check's job; null when none runs. */
  jobId: string | null
  topicId: string
  marketId: string | null
}): readonly CheckInFlightItem[] {
  const { source, jobId, topicId, marketId } = options
  const [shown, setShown] = useState<{ jobId: string; items: readonly CheckInFlightItem[] }>({
    jobId: '',
    items: []
  })
  useEffect(() => {
    if (jobId === null || source.onCheckProgress === undefined) return
    let stop: (() => void) | null = null
    try {
      stop = source.onCheckProgress((event) => {
        if (event.jobId !== jobId) return
        const items = (event.inFlightItems ?? []).filter(
          (item) => item.pageId === topicId && (marketId === null || item.marketId === marketId)
        )
        setShown({ jobId, items })
      })
    } catch {
      // No bridge (a test or a mock window): the rows' own "Checking…" still shows.
    }
    return () => stop?.()
  }, [source, jobId, topicId, marketId])
  return jobId !== null && shown.jobId === jobId ? shown.items : []
}

/** One running question for the banner: its id and "Q7". */
export interface RunningRef {
  promptId: string
  label: string
}

/**
 * The banner's "Checking Q7, Q8, Q9 now": the questions in flight, labelled as their
 * rows are; before the first push, the rows marked as checking.
 */
export function runningRefs(
  items: readonly CheckInFlightItem[],
  rows: readonly TopicResultRow[]
): RunningRef[] {
  const byId = new Map(rows.map((row) => [row.promptId, row]))
  if (items.length === 0) {
    return rows
      .filter((row) => row.live === 'checking')
      .map((row) => ({ promptId: row.promptId, label: promptLabel(row) }))
  }
  return items.map((item) => {
    const row = byId.get(item.promptId)
    return { promptId: item.promptId, label: promptLabel(row ?? item) }
  })
}

/** What a checking row waits on: the engines not back yet, and those as words. */
export interface CheckingRow {
  engines: readonly EngineId[]
  /** "Checking Google · ChatGPT…", or "Checking…" once every engine is back. */
  words: string
}

export function checkingRows(items: readonly CheckInFlightItem[]): Map<string, CheckingRow> {
  const out = new Map<string, CheckingRow>()
  for (const item of items) {
    const engines = item.engines.filter((entry) => entry.status === null).map((e) => e.engine)
    out.set(item.promptId, {
      engines,
      words:
        engines.length === 0
          ? 'Checking…'
          : `Checking ${engines.map((engine) => ENGINE_SHORT_LABEL[engine]).join(' · ')}…`
    })
  }
  return out
}

/**
 * Scrolls a grid row into view and focuses it, once a view switch has drawn it. The
 * switch may take a few frames (the URL change, then the new view), so it looks again
 * for a short while.
 */
export function showRow(promptId: string, frames = 20): void {
  const row = document.querySelector<HTMLElement>(`[data-line-key="row:${CSS.escape(promptId)}"]`)
  if (!row) {
    if (frames > 0) requestAnimationFrame(() => showRow(promptId, frames - 1))
    return
  }
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  row.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' })
  row.focus({ preventScroll: true })
}
