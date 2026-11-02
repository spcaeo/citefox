/** Schedules, the check queue, and the tray. */

import type { IpcHandlersFor, queueChannels, scheduleChannels, trayChannels } from '@shared/ipc'
import type { bindScheduleQueueTray } from '../scheduler/ipc'
import { guard, type EngineContext } from './context'

type ScheduleQueueTray = ReturnType<typeof bindScheduleQueueTray>

export function scheduleHandlers(
  ctx: EngineContext,
  scheduleQueueTray: ScheduleQueueTray
): IpcHandlersFor<typeof scheduleChannels> &
  IpcHandlersFor<typeof queueChannels> &
  IpcHandlersFor<typeof trayChannels> {
  return {
    'tray:getLine': (request) =>
      guard('tray:getLine', ctx, () => scheduleQueueTray.tray.getLine(request)),
    'schedule:getApp': () =>
      guard('schedule:getApp', ctx, () => scheduleQueueTray.schedule.getApp()),
    'schedule:updateApp': (request) =>
      guard('schedule:updateApp', ctx, () => scheduleQueueTray.schedule.updateApp(request)),
    'schedule:getProject': (request) =>
      guard('schedule:getProject', ctx, () => scheduleQueueTray.schedule.getProject(request)),
    'schedule:updateProject': (request) =>
      guard('schedule:updateProject', ctx, () => scheduleQueueTray.schedule.updateProject(request)),
    'schedule:listDue': (request) =>
      guard('schedule:listDue', ctx, () => scheduleQueueTray.schedule.listDue(request)),
    'queue:getStatus': () =>
      guard('queue:getStatus', ctx, () => scheduleQueueTray.queue.getStatus()),
    'queue:pause': (request) =>
      guard('queue:pause', ctx, () => scheduleQueueTray.queue.pause(request)),
    'queue:resume': () => guard('queue:resume', ctx, () => scheduleQueueTray.queue.resume()),
    'queue:checkDue': () => guard('queue:checkDue', ctx, () => scheduleQueueTray.queue.checkDue()),
    'tray:getMenu': () => guard('tray:getMenu', ctx, () => scheduleQueueTray.tray.getMenu())
  }
}
