import type { JSX } from 'react'
import type { CitationReview } from '@shared/ipc'
import { Button, UiIcon } from '../../ui'
import { attentionSummary } from '../utils/attention'

/**
 * Needs attention as one line ("66 need attention · Review") above a long grid
 * (deep audit §7h): the grid owns the page, and Review opens the full list
 * (`#/pages?attention=open`, so the open list has a URL).
 */
export function AttentionBar({
  review,
  onOpen
}: {
  review: CitationReview
  onOpen: () => void
}): JSX.Element {
  const count = review.wrongPage.length + review.untracked.filter((item) => !item.ignored).length
  return (
    <section className="ap-attn-bar ui-tint" data-tint="attention" aria-label="Needs attention">
      <UiIcon name="warning" size={16} />
      <h2 className="ap-attn-title">
        Needs attention <span className="ui-sechead-count num">{count}</span>
      </h2>
      <p className="ap-attn-text">{attentionSummary(review)}</p>
      <Button size="sm" aria-expanded={false} onClick={onOpen}>
        Review
      </Button>
    </section>
  )
}
