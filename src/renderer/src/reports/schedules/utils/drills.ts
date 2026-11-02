import {
  normalizeExportSections,
  type DeliveryRecord,
  type ReportScheduleListItem
} from '@shared/domain'
import { REPORT_SECTION_COPY } from '@shared/report-copy'
import type { DrillScope, ItemDrill } from '../../../drill'
import { formatLabel, resultPhrase, whenLabel } from '../../scheduleModel'
import { upcomingSends } from './occurrences'

/** Scheduled reports are not tied to a page, market or check. */
export const NO_SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: '',
  brand: '',
  domain: ''
}

const SUMMARY_PARTS = ['Headline', 'Score', 'What changed', 'What to do next'] as const

/** What a schedule's report holds: one row per section (or per summary part). */
export function sectionsDrill(item: ReportScheduleListItem): ItemDrill {
  const summary = item.format === 'summary'
  const items = summary
    ? SUMMARY_PARTS.map((part) => ({ id: `part:${part}`, primary: part }))
    : normalizeExportSections(item.sections).map((id) => ({
        id: `section:${id}`,
        primary: REPORT_SECTION_COPY[id].title,
        secondary: REPORT_SECTION_COPY[id].description
      }))
  return {
    kind: 'items',
    id: `schedule:${item.id}:sections`,
    title: `What ${item.name} sends`,
    description: summary
      ? 'No attachment. The email holds this summary, written from the latest check.'
      : `${formatLabel(item.format)}. The cover is always included.`,
    noun: summary ? ['part', 'parts'] : ['section', 'sections'],
    primaryLabel: summary ? 'Part' : 'Section',
    items,
    scope: NO_SCOPE
  }
}

/** The newest delivery of this schedule that went to `address`. */
function lastTo(
  scheduleId: string,
  address: string,
  deliveries: readonly DeliveryRecord[]
): DeliveryRecord | null {
  let best: DeliveryRecord | null = null
  for (const record of deliveries) {
    if (record.scheduleId !== scheduleId || !record.recipients.includes(address)) continue
    if (!best || record.at > best.at) best = record
  }
  return best
}

/** Who a schedule emails, with each address's last result. */
export function recipientsDrill(
  item: ReportScheduleListItem,
  deliveries: readonly DeliveryRecord[],
  timeZone: string
): ItemDrill {
  return {
    kind: 'items',
    id: `schedule:${item.id}:recipients`,
    title: `Recipients of ${item.name}`,
    description: 'Each address and the result of the last email it was sent.',
    noun: ['recipient', 'recipients'],
    primaryLabel: 'Address',
    columns: [{ id: 'last', label: 'Last result', width: 'minmax(120px, 0.8fr)' }],
    items: item.recipients.map((address) => {
      const last = lastTo(item.id, address, deliveries)
      const failed = last?.outcome === 'failed'
      return {
        id: `rcpt:${address}`,
        primary: address,
        mono: true,
        cells: { last: last ? resultPhrase(last, timeZone) : 'Not sent yet' },
        group: !last ? 'unsent' : failed ? 'failed' : 'sent',
        detail:
          failed && last?.reason
            ? [last.reason, last.nextStep].filter((part) => part !== null).join(' ')
            : null
      }
    }),
    summary: [
      { label: 'Sent', group: 'sent' },
      { label: 'Failed', group: 'failed' },
      { label: 'Not sent yet', group: 'unsent' }
    ],
    scope: NO_SCOPE
  }
}

/**
 * The next sends of a schedule, or what triggers a change alert. Null when
 * nothing is coming (paused, or its project is paused).
 */
export function nextDrill(item: ReportScheduleListItem): ItemDrill | null {
  if (item.status === 'paused') return null
  if (item.timing.kind === 'on_change') {
    const events = item.timing.events
    return {
      kind: 'items',
      id: `schedule:${item.id}:next`,
      title: `What sends ${item.name}`,
      description:
        'This alert has no fixed time. It sends after a check when one of these happens.',
      noun: ['trigger', 'triggers'],
      primaryLabel: 'Sends when',
      items: (events.length > 0 ? events : ['lost_citation' as const]).map((event) => ({
        id: `event:${event}`,
        primary: whenLabel({ kind: 'on_change', events: [event], scoreDropPoints: 0 })
      })),
      scope: NO_SCOPE
    }
  }
  const sends = upcomingSends(item)
  if (sends.length === 0) return null
  return {
    kind: 'items',
    id: `schedule:${item.id}:next`,
    title: `Next sends of ${item.name}`,
    description:
      item.timing.kind === 'after_check'
        ? 'This report sends after each check. The next check is the only time CiteFox knows.'
        : `Times are in ${item.timeZone}.`,
    noun: ['send', 'sends'],
    primaryLabel: 'Day',
    columns: [{ id: 'time', label: 'Time', width: '80px' }],
    items: sends.map((send) => ({
      id: `send:${send.day}`,
      primary: send.dayLabel,
      cells: { time: send.time }
    })),
    scope: NO_SCOPE
  }
}

/** A schedule's deliveries, newest first. */
export function deliveriesOf(
  scheduleId: string,
  deliveries: readonly DeliveryRecord[]
): DeliveryRecord[] {
  return deliveries
    .filter((record) => record.scheduleId === scheduleId)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
