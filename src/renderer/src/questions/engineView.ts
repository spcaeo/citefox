import type { EngineAnswerStatus, EngineId } from '@shared/domain'
import type { QuestionRow } from '@shared/ipc'
import { questionKey, type StatusMap } from '../engines/model'

/** A question row's statuses per engine: where it lives now, else where it was checked. */
export function rowStatuses(
  row: QuestionRow,
  statuses: StatusMap
): Partial<Record<EngineId, EngineAnswerStatus>> | undefined {
  const here = statuses.get(questionKey(row.sourceId, row.promptId))
  if (here !== undefined) return here
  if (row.resultPageId === null) return undefined
  return statuses.get(questionKey(row.resultPageId, row.resultPromptId ?? row.promptId))
}

/** The engine KPI tiles that open their questions. */
export type EngineKpiPart = 'answered' | 'cited' | 'named'

/** The tracked rows a part counts on one engine (the tiles' numbers are these lengths). */
export function engineKpiRows(
  rows: readonly QuestionRow[],
  statuses: StatusMap,
  engine: EngineId,
  part: EngineKpiPart
): QuestionRow[] {
  return rows.filter((row) => {
    if (!row.enabled) return false
    const status = rowStatuses(row, statuses)?.[engine]
    if (part === 'cited') return status === 'cited'
    if (part === 'named') return status === 'named'
    return status === 'cited' || status === 'named' || status === 'not_cited'
  })
}

/** Tracked questions this engine was down for (cloro reported it unavailable). */
export function unavailableCount(
  rows: readonly QuestionRow[],
  statuses: StatusMap,
  engine: EngineId
): number {
  return rows.filter((row) => row.enabled && rowStatuses(row, statuses)?.[engine] === 'unavailable')
    .length
}
