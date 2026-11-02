import { TRAY_MENU_CHECK_LIMIT } from '@shared/domain'
import type { TrayMenu } from '@shared/domain'
import type { TrayLine } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { planSchedule } from '../scheduler/due'
import type { CheckSession } from '../scheduler/session'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export interface TrayHandlers {
  getLine(request: unknown): TrayLine
  getMenu(): TrayMenu
  /**
   * FR-24.8. The menu-bar icon calls this. Not an IPC channel.
   * `tray:getLine` reads the flag. The existing `queue:status` event carries it too.
   */
  setRunning(running: boolean): void
}

/**
 * `tray:getLine` is the sidebar sentence (FR-24.8). `running` stays false until
 * `setRunning(true)`. `tray:getMenu` is the menu facts (FR-24.6).
 * Open, Quit, and Ask CiteFox are not fields.
 */
export function createTrayHandlers(session: CheckSession): TrayHandlers {
  return {
    getLine(request: unknown): TrayLine {
      const projectId = parseProjectId(request)
      session.refresh()
      const plan = planSchedule(session.catalog(), session.clock.now(), session.timeZone)
      const project = plan.projects.find((item) => item.projectId === projectId)
      if (project === undefined) throw new IpcRequestError('tray:getLine', 'Unknown project')
      return {
        projectId,
        running: session.store.trayRunning(),
        pagesDueToday: project.pagesDueToday
      }
    },
    getMenu(): TrayMenu {
      session.refresh()
      const status = session.queue.status()
      const plan = planSchedule(session.catalog(), session.clock.now(), session.timeZone)
      const pagesDueToday = plan.projects.reduce((sum, project) => sum + project.pagesDueToday, 0)
      const lastChecks = [...session.store.lastChecks()]
        .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0))
        .slice(0, TRAY_MENU_CHECK_LIMIT)
      return {
        pausedToday: status.state === 'paused_today',
        pagesDueToday,
        pagesWaiting: status.waiting,
        lastChecks
      }
    },
    setRunning(running: boolean): void {
      session.store.setTrayRunning(running)
      session.refresh()
      session.emitStatus(session.queue.status())
    }
  }
}

function parseProjectId(value: unknown): string {
  const channel = 'tray:getLine'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== 'projectId') throw new IpcRequestError(channel)
  const projectId = record.projectId
  if (typeof projectId !== 'string' || !ID.test(projectId)) throw new IpcRequestError(channel)
  return projectId
}
