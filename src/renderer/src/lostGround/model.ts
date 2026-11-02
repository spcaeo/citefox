import type { IntentStage, PromptCheckRow } from '@shared/domain'
import { isCited, isLostGround } from '@shared/fix-loop'
import type { AssistResult, LostBucket, LostGroundView } from '@shared/ipc'
import { stageLabel } from '../m3/model'

/** Lost ground: where the questions that cited a page went. Pure. */

export const LOST_BUCKETS: readonly { id: LostBucket; label: string }[] = [
  { id: 'still_cited', label: 'Still citing this page' },
  { id: 'moved_tracked', label: 'Moved to your other tracked pages' },
  { id: 'moved_own', label: 'Moved to other pages on your site' },
  { id: 'not_cited', label: 'No longer cited' }
]

/** Questions that cited the page in the older check. */
export function citedBefore(view: Pick<LostGroundView, 'before'>): PromptCheckRow[] {
  return view.before.rows.filter(isCited)
}

/** A bucket's questions as they stand in the latest check, in prompt order. */
export function bucketRows(view: LostGroundView, bucket: LostBucket): PromptCheckRow[] {
  const ids = new Set(view.buckets[bucket])
  return view.now.rows.filter((row) => ids.has(row.promptId))
}

/** Questions that cited the page before and cite something else, or nothing, now. */
export function lostRows(view: LostGroundView): PromptCheckRow[] {
  const ids = new Set([
    ...view.buckets.moved_tracked,
    ...view.buckets.moved_own,
    ...view.buckets.not_cited
  ])
  return view.now.rows.filter((row) => ids.has(row.promptId))
}

export interface StageRow {
  stage: IntentStage
  label: string
  /** Lost questions of this stage, as they stand now. */
  lost: readonly PromptCheckRow[]
  /** Questions of this stage that cited the page before. */
  before: readonly PromptCheckRow[]
}

/** Lost questions grouped by buying stage, most lost first. */
export function stageRows(view: LostGroundView): StageRow[] {
  const lost = lostRows(view)
  const cited = citedBefore(view)
  const stages = [...new Set(lost.map((row) => row.intentStage))]
  return stages
    .map((stage) => ({
      stage,
      label: stageLabel(stage),
      lost: lost.filter((row) => row.intentStage === stage),
      before: cited.filter((row) => row.intentStage === stage)
    }))
    .sort((a, b) => b.lost.length - a.lost.length || a.label.localeCompare(b.label))
}

/** The key a recovery plan is saved under: the two checks it compares. */
export function planKey(view: Pick<LostGroundView, 'before' | 'now'>): string {
  return `${view.before.runId}|${view.now.runId}`
}

/** The cached plan, only when it is for these two checks. */
export function currentPlan(view: LostGroundView): LostGroundView['plan'] {
  return view.plan && view.plan.inputKey === planKey(view) ? view.plan : null
}

/** An assist answer as plan Markdown: its summary, then the picked items as a numbered list. */
export function planFromAssist(result: AssistResult, ids: readonly string[]): string {
  const items = result.items.filter((item) => ids.length === 0 || ids.includes(item.id))
  const lines = items.map(
    (item, index) => `${index + 1}. ${item.text}${item.detail ? ` ${item.detail}` : ''}`
  )
  return [result.summary ?? '', lines.join('\n')].filter((part) => part.trim()).join('\n\n')
}

/**
 * The Results callout: did the latest check lose ground against the one before?
 * Reads each row's `previousStatus`, so it needs no other check.
 */
export function lostSinceLast(rows: readonly PromptCheckRow[]): {
  citedBefore: number
  lost: number
  lostGround: boolean
} {
  const before = rows.filter((row) => row.previousStatus === 'page_cited')
  const lost = before.filter((row) => !isCited(row)).length
  return {
    citedBefore: before.length,
    lost,
    lostGround: isLostGround({ citedBefore: before.length, lost })
  }
}
