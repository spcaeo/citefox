import type { CitationReview } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'

/** More grid rows than this and Needs attention starts as one line, so the grid starts high. */
export const ATTENTION_COLLAPSE_ROWS = 50

/** "65 wrong-page cases on 39 tracked pages · 1 page cited but not tracked". */
export function attentionSummary(review: CitationReview): string {
  const parts: string[] = []
  if (review.wrongPage.length > 0) {
    parts.push(
      `${pluralize(review.wrongPage.length, 'wrong-page case')} on ${pluralize(review.wrongPagePages, 'tracked page')}`
    )
  }
  const untracked = review.untracked.filter((item) => !item.ignored).length
  if (untracked > 0) parts.push(`${pluralize(untracked, 'page')} cited but not tracked`)
  return parts.join(' · ')
}
