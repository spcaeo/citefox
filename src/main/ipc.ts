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
import type { Logger } from './logging/logger'
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
export function registerIpcHandlers(handlers: IpcHandlerMap, logger?: Pick<Logger, 'warn'>): void {
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
        () => logIpcFailure(logger, channel, () => callIpcHandler(handlers, channel, args))
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

/**
 * One log line when a handler throws or answers `ok: false`, so a tester's log shows which
 * action failed and why. It records the channel and the reason only: never the request,
 * and never the message text, which can carry a page or a question.
 */
export async function logIpcFailure<T>(
  logger: Pick<Logger, 'warn'> | undefined,
  channel: string,
  run: () => T | Promise<T>
): Promise<T> {
  let result: T
  try {
    result = await run()
  } catch (error) {
    logger?.warn('action failed', {
      channel,
      threw: error instanceof Error ? error.name : typeof error
    })
    throw error
  }
  if (logger !== undefined && typeof result === 'object' && result !== null) {
    const record = result as Record<string, unknown>
    if (record.ok === false) {
      const code = ['code', 'errorCode', 'reason', 'kind']
        .map((key) => record[key])
        .find(isShortCode)
      logger.warn('action did not finish', { channel, reason: code ?? null })
    }
  }
  return result
}

function isShortCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 40 &&
    /^[a-z0-9_.:-]+$/i.test(value)
  )
}
