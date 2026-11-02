import type { CheckEngine } from '../engine/checks/engine'
import { engineEmailFor, type EngineEmail } from '../email/engine-email'
import type { NotifyResult } from '../email/types'
import type { AppStorage } from '../storage/app-storage'
import type { AlertDesktopNotice, AlertSenders } from './deliver'
import type { AlertRulesService } from './service'

/**
 * Alert rules run after every check job, whoever started it (Check now, a schedule, a
 * follow-up, a resumed job): the engine is wrapped once where it is created, so there
 * is one hook and the engine itself does not know about alerts. `start` resolves after
 * the evaluation, so a headless pass never closes storage under it.
 */
export function withAlertRules(engine: CheckEngine, alerts: AlertRulesService): CheckEngine {
  return {
    ...engine,
    async start(request, options) {
      const job = await engine.start(request, options)
      await alerts.evaluateJob(job.projectId, job.id)
      return job
    },
    async resumeInterrupted() {
      const jobs = await engine.resumeInterrupted()
      for (const job of jobs) await alerts.evaluateJob(job.projectId, job.id)
      return jobs
    }
  }
}

/** Alert senders that may own an email host they opened themselves. */
export type HostedAlertSenders = AlertSenders & {
  /** Closes the email host these senders opened (if any). Safe to call twice. */
  close(): void
}

/**
 * Production senders: email and Slack through the host's email service (so they land
 * in delivery history and use the project's sending account and keychain webhook),
 * and desktop through the tray. The window's host is used when one is open; with
 * none open (a headless `--check-due` pass, or an alert before the window's host
 * is up) `open` starts one on first use, so a scheduled check's email and Slack go
 * out the same way an interactive check's do. Without `open` and without a host,
 * email and Slack report a failure in the Alert log instead of sending.
 */
export function emailServiceSenders(
  storage: AppStorage,
  desktop: (notice: AlertDesktopNotice) => void,
  open?: () => EngineEmail
): HostedAlertSenders {
  let own: EngineEmail | undefined
  const host = (): EngineEmail | undefined => {
    const shared = engineEmailFor(storage.db)
    if (shared !== undefined) return shared
    if (open === undefined) return undefined
    own ??= open()
    return own
  }
  return {
    desktop,
    async email(input) {
      const email = host()
      if (email === undefined) return false
      const settings = email.service.getAlerts({ projectId: input.projectId })
      const result = await email.service.sendRecorded({
        trigger: 'check_summary',
        scheduleId: null,
        projectId: input.projectId,
        accountId: settings.emailAccountId,
        to: input.to,
        subject: input.subject,
        text: input.text
      })
      return delivered(result)
    },
    async slack(input) {
      const email = host()
      if (email === undefined) return false
      return delivered(await email.service.postSlack(input))
    },
    close() {
      own?.close()
      own = undefined
    }
  }
}

function delivered(result: NotifyResult): boolean {
  if (result.action === 'skipped') return result.reason === 'already_sent'
  return result.delivery.outcome !== 'failed'
}
