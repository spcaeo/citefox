import type { IpcEventChannel, IpcEventPayload } from '@shared/ipc'

/** A window's `webContents`, or a test double with the same `send`. */
export interface IpcEventSender {
  send(channel: string, payload: unknown): void
}

/**
 * Push one allow-listed event to one sender.
 * This does not decide when an event is produced.
 */
export function emitIpcEvent<E extends IpcEventChannel>(
  sender: IpcEventSender,
  channel: E,
  payload: IpcEventPayload<E>
): void {
  sender.send(channel, payload)
}

/** What main modules call to push an allow-listed event. */
export type MainIpcEmitter = <E extends IpcEventChannel>(
  channel: E,
  payload: IpcEventPayload<E>
) => void

/** Emitter that forwards each event to one sender. */
export function createMainIpcEmitter(sender: IpcEventSender): MainIpcEmitter {
  return (channel, payload) => {
    emitIpcEvent(sender, channel, payload)
  }
}

let emitter: MainIpcEmitter = () => undefined

/** Remember the emitter `createIpcHandlers` was given. Later modules call `emitMainEvent`. */
export function bindMainIpcEmitter(next: MainIpcEmitter): void {
  emitter = next
}

/**
 * Push an allow-listed event through the emitter bound at startup.
 * `checks:progress`, `checks:finished`, `queue:status`, and `exports:progress`
 * have no producer yet.
 */
export function emitMainEvent<E extends IpcEventChannel>(
  channel: E,
  payload: IpcEventPayload<E>
): void {
  emitter(channel, payload)
}
