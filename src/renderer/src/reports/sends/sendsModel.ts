import type { AlertSettings, AutoExport, ReportScheduleListItem } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { projectHash, sectionHash } from '../../shell/routes'
import { projectDisplay, whenLabel, type NamedProject } from '../scheduleModel'
import { scheduleHref } from '../schedules/utils/scheduleUrl'

/** Everything CiteFox sends or writes on its own, in one list (Reports › All sends). */
export type SendKind = 'schedule' | 'after_check' | 'monthly_pdf' | 'slack' | 'auto_export'

export const SEND_KIND_LABELS: Readonly<Record<SendKind, string>> = {
  schedule: 'Scheduled report',
  after_check: 'Email after each check',
  monthly_pdf: 'Monthly client PDF',
  slack: 'Slack message',
  auto_export: 'Automatic export'
}

export interface SendRow {
  id: string
  kind: SendKind
  kindLabel: string
  /** The schedule's name, else the kind. */
  name: string
  projectId: string | null
  project: string
  /** Recipients, a folder, or "Slack channel". */
  to: string
  /** "Mondays 08:00", "After every check", "1st of each month". */
  when: string
  on: boolean
  /** Where it is set, as a link. */
  where: { label: string; href: string }
}

/** What each project has set outside Reports (`alerts:get`, `exports:getAuto`). Null: not read. */
export interface ProjectSends {
  projectId: string
  alerts: AlertSettings | null
  auto: AutoExport | null
  /** Why a setting could not be read. */
  problem: string | null
}

function alertsHref(projectId: string): string {
  return projectHash(projectId, `${sectionHash('alerts')}/notifications`)
}

function exportHref(projectId: string): string {
  return projectHash(projectId, sectionHash('export'))
}

/** One row per scheduled report, then per project: email after checks, monthly PDF, Slack, auto-export. */
export function sendRows(
  items: readonly ReportScheduleListItem[],
  settings: readonly ProjectSends[],
  projects: readonly ProjectDetail[],
  named: readonly NamedProject[]
): SendRow[] {
  const rows: SendRow[] = items.map((item) => ({
    id: `schedule:${item.id}`,
    kind: 'schedule',
    kindLabel: SEND_KIND_LABELS.schedule,
    name: item.name,
    projectId: item.projectId,
    project: projectDisplay(item.projectId, named).name,
    to: item.recipients.join(', '),
    when: whenLabel(item.timing),
    on: item.status === 'active',
    where: { label: 'Reports › Schedules', href: scheduleHref(item.id) }
  }))
  for (const project of projects) {
    const found = settings.find((entry) => entry.projectId === project.id)
    if (!found) continue
    const name = project.name
    const alerts = found.alerts
    if (alerts) {
      rows.push({
        id: `after_check:${project.id}`,
        kind: 'after_check',
        kindLabel: SEND_KIND_LABELS.after_check,
        name: SEND_KIND_LABELS.after_check,
        projectId: project.id,
        project: name,
        to: alerts.emailTo.length > 0 ? alerts.emailTo.join(', ') : 'No address yet',
        when: 'After every check',
        on: alerts.emailAfterCheck,
        where: { label: 'Alerts & schedules › Notifications', href: alertsHref(project.id) }
      })
      rows.push({
        id: `monthly_pdf:${project.id}`,
        kind: 'monthly_pdf',
        kindLabel: SEND_KIND_LABELS.monthly_pdf,
        name: SEND_KIND_LABELS.monthly_pdf,
        projectId: project.id,
        project: name,
        to: alerts.monthlyPdfTo ?? 'No address yet',
        when: '1st of each month',
        on: alerts.monthlyClientPdf,
        where: { label: 'Alerts & schedules › Notifications', href: alertsHref(project.id) }
      })
      rows.push({
        id: `slack:${project.id}`,
        kind: 'slack',
        kindLabel: SEND_KIND_LABELS.slack,
        name: SEND_KIND_LABELS.slack,
        projectId: project.id,
        project: name,
        to: alerts.slackWebhookStored ? 'Slack channel (webhook saved)' : 'No webhook yet',
        when: 'After every check',
        on: alerts.slackEnabled,
        where: { label: 'Alerts & schedules › Notifications', href: alertsHref(project.id) }
      })
    }
    const auto = found.auto
    if (auto) {
      rows.push({
        id: `auto_export:${project.id}`,
        kind: 'auto_export',
        kindLabel: SEND_KIND_LABELS.auto_export,
        name: SEND_KIND_LABELS.auto_export,
        projectId: project.id,
        project: name,
        to: auto.folder ?? 'No folder yet',
        when: 'After every scheduled check',
        on: auto.enabled,
        where: { label: 'Export › Send it automatically', href: exportHref(project.id) }
      })
    }
  }
  return rows
}

/** "6 of 14 on". */
export function sendsCountLine(rows: readonly SendRow[]): string {
  const on = rows.filter((row) => row.on).length
  return `${on} of ${pluralize(rows.length, 'send')} on`
}
