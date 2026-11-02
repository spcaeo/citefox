import type { FixPromptResult, FixPromptState, FixVerdict } from '@shared/domain'
import { movementFor } from '../checks/score'

/**
 * FR-14.7. One targeted prompt, before and after a fix. Uses the section 7.3
 * movement labels Results shows, so a "Worked" here is a "gained" or
 * "improved" there. Nothing here claims the edit caused the move.
 */
export function promptResult(
  before: FixPromptState | null,
  after: FixPromptState | null
): FixPromptResult {
  if (before === null || after === null) return 'not_checked'
  const movement = movementFor(before, after)
  if (movement === 'gained' || movement === 'improved') return 'worked'
  if (movement === 'lost' || movement === 'declined') return 'got_worse'
  return 'no_change'
}

export interface VerdictCount {
  verdict: FixVerdict
  /** Prompts with both a before and an after result. */
  compared: number
  worked: number
  worse: number
}

/**
 * FR-14.7. Every compared prompt better: worked. Some: partly worked. None
 * better and some worse: got worse. Otherwise no change. With no after check,
 * or nothing to compare, the fix is waiting.
 */
export function verdictFor(results: readonly FixPromptResult[], hasAfter: boolean): VerdictCount {
  const compared = results.filter((result) => result !== 'not_checked').length
  const worked = results.filter((result) => result === 'worked').length
  const worse = results.filter((result) => result === 'got_worse').length
  if (!hasAfter || compared === 0) return { verdict: 'waiting', compared, worked, worse }
  if (worked === compared) return { verdict: 'worked', compared, worked, worse }
  if (worked > 0) return { verdict: 'partly', compared, worked, worse }
  if (worse > 0) return { verdict: 'got_worse', compared, worked, worse }
  return { verdict: 'no_change', compared, worked, worse }
}

/**
 * The FR-14.7 comparison line: of the prompts the fix did not target, how many
 * moved (any section 7.3 movement other than unchanged) between two checks.
 * Prompts missing from either check are not counted.
 */
export function otherPromptsMoved(
  before: ReadonlyMap<string, FixPromptState>,
  after: ReadonlyMap<string, FixPromptState>,
  targeted: ReadonlySet<string>
): { total: number; moved: number; promptIds: string[] } {
  const promptIds: string[] = []
  let total = 0
  for (const [promptId, previous] of before) {
    if (targeted.has(promptId)) continue
    const current = after.get(promptId)
    if (current === undefined) continue
    total += 1
    const movement = movementFor(previous, current)
    if (movement !== null && movement !== 'unchanged') promptIds.push(promptId)
  }
  return { total, moved: promptIds.length, promptIds }
}
