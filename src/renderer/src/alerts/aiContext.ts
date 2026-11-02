import type { AppSchedule, ProjectSchedule } from '@shared/domain'
import type { AiContextPatch } from '../assistant/context/types'
import type { AlertView, EmailView } from './client'
import { ALERTS_TABS, type AlertsTab } from './tabs'

/**
 * What Ask CiteFox knows about Schedule & alerts: the open tab and the
 * settings it shows, as short facts. Never a recipient address or a webhook.
 */
export function alertsAiPatch(input: {
  tab: AlertsTab
  app: AppSchedule | null
  project: ProjectSchedule | null
  alerts: AlertView | null
  email: EmailView | null
}): AiContextPatch {
  const { app, project, alerts, email } = input
  const facts: string[] = []
  if (app) {
    facts.push(`Daily check time: ${app.dailyCheckTime}`)
    facts.push(`Check when CiteFox is closed: ${onOff(app.checkWhenClosed)}`)
    facts.push(`Start at login: ${onOff(app.startAtLogin)}`)
    facts.push(`Catch up after sleep: ${onOff(app.catchUpAfterSleep)}`)
  }
  if (project) {
    facts.push(
      `This project re-checks ${project.defaultIntervalDays === 1 ? 'every day' : `every ${project.defaultIntervalDays} days`}${project.paused ? ' (paused)' : ''}`
    )
    facts.push(
      project.quietFrom && project.quietUntil
        ? `Quiet hours: ${project.quietFrom}–${project.quietUntil}`
        : 'Quiet hours: off'
    )
  }
  if (alerts) {
    facts.push(`Desktop alerts: ${onOff(alerts.desktop)}`)
    facts.push(`Email after each check: ${onOff(alerts.emailAfterCheck)}`)
    facts.push(`Slack alerts: ${onOff(alerts.slackEnabled)}`)
    facts.push(`Monthly client PDF: ${onOff(alerts.monthlyClientPdf)}`)
  }
  if (email) {
    const mode = email.mode === 'smtp' ? 'SMTP' : 'Mail app'
    facts.push(`Email sending: ${mode} · ${email.accounts.length} accounts`)
  }
  return {
    filters: { tab: ALERTS_TABS.find((item) => item.id === input.tab)?.label ?? input.tab },
    ...(project
      ? { numbers: [{ label: 'Pages due today', value: String(project.pagesDueToday) }] }
      : {}),
    facts
  }
}

function onOff(value: boolean): string {
  return value ? 'on' : 'off'
}
