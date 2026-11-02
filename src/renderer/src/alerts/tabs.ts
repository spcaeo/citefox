import type { ProjectSchedule } from '@shared/domain'
import { alertsHash } from '../shell/routes'
import type { ProjectScheduleRow } from './model'

export type AlertsTab = 'rules' | 'notifications' | 'log'

/**
 * This project's alerts: the rules, where they go, and what they sent. Each
 * setting has one home, so the re-check cadence lives in Project settings ›
 * Schedule, and check timing and email accounts in App settings (an old
 * `#/alerts/recheck`, `/schedule` or `/email` link redirects there).
 */
export const ALERTS_TABS: readonly { id: AlertsTab; label: string }[] = [
  { id: 'rules', label: 'Alert rules' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'log', label: 'Alert log' }
]

function isAlertsTab(value: string | undefined): value is AlertsTab {
  return ALERTS_TABS.some((tab) => tab.id === value)
}

/**
 * The tab a route opens: `#/alerts/log` opens Alert log, `#/alerts` Alert rules.
 * An older `#/alerts?tab=notifications` link still opens its tab.
 */
export function alertsTabFor(focus: string | undefined, tabParam?: string): AlertsTab {
  if (isAlertsTab(focus)) return focus
  if (focus === undefined && isAlertsTab(tabParam)) return tabParam
  return 'rules'
}

/** The route of a tab: `#/alerts` for Alert rules, `#/alerts/<tab>` otherwise. */
export function alertsTabHash(tab: AlertsTab): string {
  return alertsHash(tab)
}

/** The open project first, from its live schedule, then the user's other projects. */
export function scheduleRows(
  project: ProjectSchedule,
  projectName: string,
  others: readonly ProjectScheduleRow[]
): ProjectScheduleRow[] {
  return [
    {
      projectId: project.projectId,
      name: projectName,
      intervalDays: project.defaultIntervalDays,
      time: project.dailyCheckTime,
      paused: project.paused
    },
    ...others.filter((row) => row.projectId !== project.projectId)
  ]
}
