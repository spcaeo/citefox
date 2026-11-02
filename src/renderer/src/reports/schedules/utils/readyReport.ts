import {
  isScheduledReportKind,
  SCHEDULED_REPORT_KINDS,
  type ReportFormat,
  type ScheduledReport,
  type ScheduledReportKind
} from '@shared/domain'
import { REPORT_TITLES } from '@shared/report/review'

/**
 * "Which report" on a schedule: one of the ready reports (sent as the PDF Reports'
 * Download makes) or the check summary built from sections (every schedule made
 * before ready reports could be picked).
 */

/** The `<select>` value of the check summary report (stored as no report). */
export const CHECK_SUMMARY = 'checks'

export type ReportChoice = ScheduledReportKind | typeof CHECK_SUMMARY

export const REPORT_CHOICES: readonly { id: ReportChoice; label: string }[] = [
  ...SCHEDULED_REPORT_KINDS.map((kind) => ({ id: kind, label: REPORT_TITLES[kind] })),
  { id: CHECK_SUMMARY, label: 'Check summary (pick sections)' }
]

export function reportChoice(value: string): ScheduledReportKind | null {
  return isScheduledReportKind(value) ? value : null
}

/** What a ready report can attach: its PDF, its offline HTML file, or nothing. */
export const READY_FORMAT_OPTIONS: readonly { id: ReportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF report attached' },
  { id: 'html_link', label: 'Offline HTML report attached' },
  { id: 'summary', label: 'Email summary only, no attachment' }
]

export function isReadyFormat(format: ReportFormat): boolean {
  return READY_FORMAT_OPTIONS.some((option) => option.id === format)
}

/** "Head-to-head vs twilio.com", "Impact review", or null for the check summary. */
export function scheduledReportLabel(report: ScheduledReport | null | undefined): string | null {
  if (!report) return null
  const title = REPORT_TITLES[report.kind]
  return report.kind === 'rival' && report.rival ? `${title} vs ${report.rival}` : title
}

/** Starting values for a schedule of one ready report (a card's "Email on a schedule"). */
export function readyReportSeed(
  kind: ScheduledReportKind,
  rival: string | null
): { report: ScheduledReportKind; rival: string | null; name: string; subject: string } {
  const title = REPORT_TITLES[kind]
  return {
    report: kind,
    rival: kind === 'rival' ? rival : null,
    name: kind === 'rival' && rival ? `${title} vs ${rival}` : title,
    subject: `{project}: ${title} for {date_range}`
  }
}
