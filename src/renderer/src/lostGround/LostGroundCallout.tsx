import type { JSX } from 'react'
import type { PromptCheckRow } from '@shared/domain'
import { lostHash } from '../fixes/views'
import { UiIcon } from '../ui'
import { lostSinceLast } from './model'
import './lostGround.css'

/**
 * One line on a page's Results when the latest check lost ground against the one
 * before (the shared rule, read from each row's previous status). Links to Lost ground.
 */
export function LostGroundCallout({
  pageId,
  rows
}: {
  pageId: string
  rows: readonly PromptCheckRow[]
}): JSX.Element | null {
  const { lostGround, lost, citedBefore } = lostSinceLast(rows)
  if (!lostGround) return null
  return (
    <p className="lg-callout" role="note">
      <UiIcon name="trend-down" size={16} />
      <span>
        This page lost ground since the last check: {lost} of the {citedBefore} questions that cited
        it no longer do. <a href={lostHash(pageId)}>See what happened</a>
      </span>
    </p>
  )
}
