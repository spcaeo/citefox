import type { JSX } from 'react'
import type { ReportScheduleListItem } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { Confirm } from '../../../ui'
import { formatLabel } from '../../scheduleModel'

/** Recipients listed in full up to this many; the rest are counted. */
const LISTED = 6

/**
 * "Send Weekly client report now?": lists who gets it and what is attached,
 * and says the next scheduled send is not moved.
 */
export function SendNowConfirm({
  item,
  from,
  busy = false,
  onConfirm,
  onCancel
}: {
  item: Pick<ReportScheduleListItem, 'name' | 'recipients' | 'format' | 'status'>
  /** The sending account's label ("Default sender"). */
  from: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const listed = item.recipients.slice(0, LISTED)
  const more = item.recipients.length - listed.length
  return (
    <Confirm
      title={`Send ${item.name} now?`}
      tone="default"
      confirmLabel="Send now"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="sendnow-confirm"
      body={
        <>
          <p>
            CiteFox builds the report from the latest checks and emails it to{' '}
            {pluralize(item.recipients.length, 'recipient')} from {from}:
          </p>
          <ul className="rpt-confirm-list mono">
            {listed.map((address) => (
              <li key={address}>{address}</li>
            ))}
            {more > 0 ? <li>and {pluralize(more, 'more')}</li> : null}
          </ul>
          <p>
            {formatLabel(item.format)}.{' '}
            {item.status === 'paused'
              ? 'The schedule stays off.'
              : 'The next scheduled send still goes out as planned.'}
          </p>
        </>
      }
    />
  )
}
