import {
  callIpcHandler,
  IPC_INVOKE_CHANNELS,
  isIpcInvokeChannel,
  type IpcEventChannel,
  type IpcEventPayload,
  type IpcHandlerMap
} from '@shared/ipc'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { progressScope, runWithProgress } from './assist/progress'
import { emitIpcEvent } from './ipc-events'
import { isTrustedIpcSender } from './navigation'
import { urlPolicy } from './security'

/** Push a contract event to every window. The preload allow-list is the only subscriber. */
export function broadcastIpcEvent<E extends IpcEventChannel>(
  channel: E,
  payload: IpcEventPayload<E>
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    emitIpcEvent(win.webContents, channel, payload)
  }
}

/**
 * Registers invoke channels only. Push events are sent by the engine, not handled here.
 * NFR-16: a call is served only when the sending frame is app content (the
 * renderer files, or the dev server in an unpackaged build).
 */
export function registerIpcHandlers(handlers: IpcHandlerMap): void {
  const policy = urlPolicy()
  for (const channel of IPC_INVOKE_CHANNELS) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isIpcInvokeChannel(channel)) {
        throw new Error(`Blocked IPC channel: ${channel}`)
      }
      if (!isTrustedIpcSender(senderUrl(event), policy)) {
        throw new Error(`Blocked IPC sender for ${channel}`)
      }
      // Owner feedback #1: page reads and Claude calls inside the call push `assist:progress`.
      return runWithProgress(
        {
          channel,
          scope: progressScope(args),
          emit: (progress) => broadcastIpcEvent('assist:progress', progress)
        },
        () => callIpcHandler(handlers, channel, args)
      )
    })
  }
}

/** `senderFrame` is null once the frame navigated away or was destroyed. */
function senderUrl(event: IpcMainInvokeEvent): string | null {
  try {
    return event.senderFrame?.url ?? null
  } catch {
    return null
  }
}
