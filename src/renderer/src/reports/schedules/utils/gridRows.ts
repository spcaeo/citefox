import { TRIGGER_FACET, type DeliveryRow, type ScheduleRow } from '../../scheduleModel'

export function scheduleText(row: ScheduleRow): string {
  return [
    row.name,
    row.project,
    row.projectTag ?? '',
    row.formatLabel,
    row.sectionsLabel,
    row.when,
    row.recipients.join(' ')
  ].join(' ')
}

export function deliveryText(row: DeliveryRow): string {
  return [
    row.dateLabel,
    row.name,
    row.project,
    row.trigger,
    row.recipients,
    row.result,
    row.reason ?? ''
  ].join(' ')
}

export function scheduleValue(row: ScheduleRow, key: string): string | number | null {
  switch (key) {
    case 'name':
      return row.name.toLowerCase()
    case 'project':
      return row.project
    case 'what':
      return row.formatLabel.toLowerCase()
    case 'when':
      return TRIGGER_FACET.indexOf(row.trigger)
    case 'rcpts':
      return row.recipients[0] ?? null
    case 'next':
      return row.nextSort
    case 'last':
      return row.last.startsWith('Failed') ? `Failed ${row.lastSort ?? 0}` : row.lastSort
    case 'on':
      return row.status === 'active' ? 0 : 1
    case 'result':
      return row.lastFailed ? 'Failed' : 'Sent'
    default:
      return null
  }
}
