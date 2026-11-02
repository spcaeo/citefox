import { useEffect, useState } from 'react'
import type { EngineId } from '@shared/domain'
import type {
  EngineCounts,
  EngineSummaryRequest,
  EngineSummaryView,
  QuestionEngineStatuses
} from '@shared/ipc'
import { mergeCounts, offeredEngines, statusMap, type StatusMap } from './model'

/** `engines:summary`, as a screen's source or client may offer it. */
export type EngineSummaryChannel = (request: EngineSummaryRequest) => Promise<EngineSummaryView>

/** Pages one per-question request may name (the handler's limit). */
const PAGES_PER_REQUEST = 50

export interface EngineSummaryState {
  /** The engines the screen offers: two or more turn the filter and dots on. */
  engines: readonly EngineId[]
  counts: readonly EngineCounts[]
  /** Each question's statuses (`questionKey`), when they were asked for. */
  statuses: StatusMap
  /** The same statuses as read, one row per question × market. */
  questions: readonly QuestionEngineStatuses[]
  loaded: boolean
}

const EMPTY: EngineSummaryState = {
  engines: [],
  counts: [],
  statuses: new Map(),
  questions: [],
  loaded: false
}

/**
 * Each engine's latest status counts, and with `pageIds` every question's statuses
 * (asked in batches of 50 pages). A screen without the channel, or a failed read, shows
 * no engine parts: its Google view is unchanged.
 */
export function useEngineSummary(
  channel: EngineSummaryChannel | undefined,
  projectId: string,
  scope: { pageIds: readonly string[] | null; marketId: string | null; reload?: unknown }
): EngineSummaryState {
  const [state, setState] = useState<EngineSummaryState>(EMPTY)
  const { pageIds, marketId, reload } = scope
  const pagesKey = pageIds === null ? null : pageIds.join(',')

  useEffect(() => {
    if (channel === undefined) return
    let live = true
    const ids = pagesKey === null ? null : pagesKey === '' ? [] : pagesKey.split(',')
    const batches: (string[] | null)[] = []
    if (ids === null || ids.length === 0) batches.push(null)
    else
      for (let at = 0; at < ids.length; at += PAGES_PER_REQUEST) {
        batches.push(ids.slice(at, at + PAGES_PER_REQUEST))
      }
    Promise.all(
      batches.map((batch) =>
        channel({
          projectId,
          marketId,
          ...(batch === null ? {} : { pageIds: batch, perQuestion: true })
        })
      )
    )
      .then((views) => {
        if (!live) return
        const counts = mergeCounts(views.map((view) => view.counts))
        const questions = views.flatMap((view) => view.questions ?? [])
        setState({
          engines: offeredEngines(views[0]?.engines ?? [], counts),
          counts,
          statuses: statusMap(questions, marketId),
          questions,
          loaded: true
        })
      })
      .catch(() => {
        if (live) setState({ ...EMPTY, loaded: true })
      })
    return () => {
      live = false
    }
  }, [channel, projectId, pagesKey, marketId, reload])

  return state
}
