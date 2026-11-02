import type { JSX } from 'react'
import { SITE_ROLE_LABELS } from '@shared/site-role'
import { Confirm } from '../ui'
import type { PendingRemoval } from './useSourceActions'

/** "Remove Twilio from your competitors?": asked before a saved competitor takes a platform role. */
export function RemoveCompetitorConfirm({
  pending
}: {
  pending: PendingRemoval | null
}): JSX.Element | null {
  if (pending === null) return null
  return (
    <Confirm
      title={`Remove ${pending.name} from your competitors?`}
      body={`It shows as ${SITE_ROLE_LABELS[pending.role]} on every sources list in this project. You can undo this.`}
      confirmLabel="Remove competitor"
      onConfirm={pending.confirm}
      onCancel={pending.cancel}
    />
  )
}
