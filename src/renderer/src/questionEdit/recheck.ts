import { SEARCHES_PER_PROMPT_MAX, SEARCHES_PER_PROMPT_MIN } from '@shared/domain'
import type { QuestionRef } from '@shared/ipc'
import type { RecheckPlan } from '../questions/model'

/** The questions to re-check in one market, with how many samples each source runs. */
export interface RecheckRequest {
  /** Current refs (resolved to the active version). */
  refs: readonly QuestionRef[]
  /** Refs that cannot be re-checked here (paused, or gone). */
  skipped: number
  marketId: string
  marketLabel: string
  /** Samples per search for each source id; 1 when missing. */
  samples: ReadonlyMap<string, number>
}

export function recheckPlanOf(request: RecheckRequest): RecheckPlan {
  const pageIds = [...new Set(request.refs.map((ref) => ref.sourceId))]
  const samples = request.refs.reduce(
    (sum, ref) => sum + (request.samples.get(ref.sourceId) ?? 1),
    0
  )
  return {
    promptIds: request.refs.map((ref) => ref.promptId),
    pageIds,
    skipped: request.skipped,
    min: samples * SEARCHES_PER_PROMPT_MIN,
    max: samples * SEARCHES_PER_PROMPT_MAX
  }
}
