import { useState } from 'react'
import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { formatMoment } from '../../../utils/dates'
import type { Explained } from '../../scheduleModel'
import type { SchedulesClient } from '../../schedulesClient'

/** What a Send now said: sent, a draft, or why not. */
export function sendNowNote(
  sent: { row: DeliveryRecord | null; unavailable: Explained | null },
  timeZone: string
): string {
  if (sent.unavailable || !sent.row) {
    return sent.unavailable
      ? `Not sent. ${sent.unavailable.reason}${sent.unavailable.nextStep ? ` ${sent.unavailable.nextStep}` : ''}`
      : 'Not sent.'
  }
  const at = formatMoment(sent.row.at, { timeZone })
  if (sent.row.outcome === 'failed') {
    const reason = (sent.row.reason ?? 'the send failed').replace(/\.$/, '')
    return `Not sent: ${reason}. It is in Delivery history.`
  }
  if (sent.row.outcome === 'draft') return `Waiting in your mail app as a draft (${at}).`
  return `Sent to ${pluralize(sent.row.recipients.length, 'recipient')} at ${at}.`
}

export interface SendNowState {
  /** The schedule the Confirm asks about. Null: no Confirm. */
  target: ReportScheduleListItem | null
  busy: boolean
  /** The last send's result line. */
  note: string | null
  ask: (item: ReportScheduleListItem) => void
  cancel: () => void
  confirm: () => Promise<void>
}

/** Send now: a Confirm that lists the recipients, then `reports:sendNow`, then a reload. */
export function useSendNow(
  client: SchedulesClient,
  timeZone: string,
  reload: () => Promise<void>
): SendNowState {
  const [target, setTarget] = useState<ReportScheduleListItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function confirm(): Promise<void> {
    if (!target) return
    setBusy(true)
    const sent = await client.sendNow({ scheduleId: target.id })
    setBusy(false)
    setTarget(null)
    await reload()
    setNote(sendNowNote(sent, timeZone))
  }

  return {
    target,
    busy,
    note,
    ask: (item) => {
      setNote(null)
      setTarget(item)
    },
    cancel: () => setTarget(null),
    confirm
  }
}
