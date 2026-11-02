import { useSyncExternalStore } from 'react'
import type { ConsoleStore } from './store'
import type { ConsoleState } from './types'

/** The console's state, re-rendering on every change of the store. */
export function useConsoleState(store: ConsoleStore): ConsoleState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
