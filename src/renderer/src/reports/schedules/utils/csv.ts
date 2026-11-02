import type { GridCsvRequest } from '@shared/ipc'
import { csvFileName } from '../../../grid/model/labels'
import type { DeliveryRow, ScheduleRow } from '../../scheduleModel'

function onOff(row: ScheduleRow): 'On' | 'Off' {
  return row.status === 'active' ? 'On' : 'Off'
}

/** The schedules the list shows, one CSV row each (main adds the BOM and guards formulas). */
export function schedulesCsv(rows: readonly ScheduleRow[], now = new Date()): GridCsvRequest {
  return {
    fileName: csvFileName('scheduled-reports', now),
    header: ['Name', 'Project', 'What', 'When', 'Recipients', 'Next', 'Last result', 'On'],
    rows: rows.map((row) => [
      row.name,
      row.project,
      `${row.formatLabel} · ${row.sectionsLabel}`,
      row.when,
      row.recipients.join(' | '),
      row.next,
      row.lastReason ? `${row.last} · ${row.lastReason}` : row.last,
      onOff(row)
    ])
  }
}

/** The deliveries the list shows, one CSV row each. */
export function deliveriesCsv(rows: readonly DeliveryRow[], now = new Date()): GridCsvRequest {
  return {
    fileName: csvFileName('delivery-history', now),
    header: ['Date', 'Schedule', 'Project', 'Kind', 'Recipients', 'Result'],
    rows: rows.map((row) => [
      row.at,
      row.name,
      row.project,
      row.trigger,
      row.recipients,
      row.reason ? `${row.result} · ${row.reason}` : row.result
    ])
  }
}
