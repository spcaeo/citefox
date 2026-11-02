/** Fixtures shared by the IPC contract tests. Test-only: nothing in the app imports this. */

import { IPC_INVOKE_CHANNELS, type IpcHandlerMap } from './index'

export type SameKeys<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : never
  : never

export function handlersReturning(overrides: Partial<IpcHandlerMap> = {}): IpcHandlerMap {
  const unused = (): never => {
    throw new Error('unused handler')
  }
  const handlers = Object.fromEntries(
    IPC_INVOKE_CHANNELS.map((channel) => [channel, unused])
  ) as unknown as IpcHandlerMap
  return { ...handlers, ...overrides }
}
