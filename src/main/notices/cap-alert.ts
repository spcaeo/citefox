import { SEARCH_CAP_NOTICE } from '@shared/domain'
import { capResetLabel } from '../engine/checks/cap-copy'
import type { CapStopEvent } from '../engine/checks/cap-stop'
import { checkCatalogCache } from '../headless/catalog-cache'
import type { EmailService } from '../email/service/types'
import type { CapAlert } from '../queue/types'
import { projectDatabasePool } from '../storage/project-db-pool'
import { writeCapOverMonth } from '../storage/project-schedule'
import { getProject } from '../storage/records'
import type { StoredNotice } from '../storage/notices'
import { recordNotice, registerNoticeKind, type NoticeHost } from './service'

/** A desktop alert the tray shows (FR-24.7 style). `hash` is where a click opens. */
export interface DesktopNotice {
  projectId: string | null
  title: string
  body: string
  action: string
  hash: string
}

export const CAP_ALLOW_10 = 'allow_10_month'
export const CAP_WAIT = 'wait_reset'

export interface CapAlertDeps extends NoticeHost {
  /** The tray's desktop notification. Omitted headless and in tests. */
  desktop?: (notice: DesktopNotice) => void
  /** The project's cap email (`EmailService.notifyCap`). Omitted in tests. */
  email?: (alert: CapAlert) => Promise<unknown>
}

/**
 * FR-11.4 `notify` rule. One handler for every path that stops at a cap: the
 * scheduled queue's `onCapAlert`, a manual or scheduled check the engine stops,
 * and the headless pass. Once per project and month it records a notice with the
 * two choices, raises the desktop alert, and sends the cap email. Later calls the
 * same month find the open notice and do nothing.
 */
export function createCapAlertHandler(deps: CapAlertDeps): (alert: CapAlert) => void {
  registerCapNoticeKind()
  return (alert) => {
    const reset = capResetLabel(alert.month)
    const added = recordNotice(deps, {
      kind: SEARCH_CAP_NOTICE,
      projectId: alert.projectId,
      dedupeKey: `cap:${alert.projectId}:${alert.month}`,
      title: `${alert.name} reached its search cap`,
      body: `${alert.used} of ${alert.cap} searches are used this month. Checks for this project are waiting for you. The cap resets on ${reset}.`,
      actions: [
        { id: CAP_ALLOW_10, label: 'Continue this month at 10% over', primary: true },
        { id: CAP_WAIT, label: `Wait for the reset on ${reset}`, primary: false }
      ],
      data: { month: alert.month, cap: alert.cap }
    })
    if (!added) return
    try {
      deps.desktop?.({
        projectId: alert.projectId,
        title: `${alert.name} reached its search cap`,
        body: `${alert.used} of ${alert.cap} searches used. Open CiteFox to continue at 10% over or wait for ${reset}.`,
        action: 'Open',
        hash: '#/status'
      })
    } catch (error) {
      deps.logger.warn('cap desktop alert failed', {
        message: error instanceof Error ? error.message : 'failed'
      })
    }
    void deps.email?.(alert).catch((error: unknown) => {
      deps.logger.warn('cap email failed', {
        message: error instanceof Error ? error.message : 'failed'
      })
    })
  }
}

/**
 * The project's cap email, sent only when the project's alerts name recipients
 * (Project settings → Alerts). Without them nothing is sent or logged as failed.
 */
export function capEmail(
  service: Pick<EmailService, 'getAlerts' | 'notifyCap'>
): (alert: CapAlert) => Promise<unknown> {
  return async (alert) => {
    const alerts = service.getAlerts({ projectId: alert.projectId })
    if (alerts.emailTo.length === 0) return null
    return service.notifyCap({ alert, paused: false })
  }
}

/** The engine's cap stop as the queue's alert. Only the `notify` rule waits for the user. */
export function capAlertFromStop(stop: CapStopEvent, at: Date): CapAlert | null {
  if (stop.capRule !== 'notify') return null
  return {
    at: at.toISOString(),
    projectId: stop.projectId,
    name: stop.name,
    used: stop.used,
    cap: stop.cap,
    month: stop.month
  }
}

let registered = false

/** "Continue this month at 10% over" saves the month on the project; "Wait" closes the notice. */
export function registerCapNoticeKind(): void {
  if (registered) return
  registered = true
  registerNoticeKind(SEARCH_CAP_NOTICE, (notice, actionId, host) =>
    applyCapChoice(notice, actionId, host)
  )
}

function applyCapChoice(notice: StoredNotice, actionId: string, host: NoticeHost): string {
  const month = typeof notice.data.month === 'string' ? notice.data.month : null
  const project = notice.projectId === null ? null : getProject(host.storage.db, notice.projectId)
  if (actionId !== CAP_ALLOW_10 || project === null || month === null) {
    return month === null
      ? 'CiteFox will wait for the cap to reset.'
      : `CiteFox will wait for the cap to reset on ${capResetLabel(month)}.`
  }
  writeCapOverMonth(projectDatabasePool(host.storage).get(project.slug), month)
  checkCatalogCache(host.storage).invalidate()
  return `Checks for ${project.name} continue this month, up to 10% over the cap. Next month the cap waits for you again.`
}
