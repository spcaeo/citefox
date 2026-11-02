import { createIpcConsoleClient } from './client'
import { sharedConsoleStore, type ConsoleStore } from './store'

/** The one console store of the window, fed by the main process's progress events. */
export function appConsoleStore(): ConsoleStore {
  return sharedConsoleStore(createIpcConsoleClient)
}

/** Opens the console, or minimises it when it is open. */
export function toggleWorkConsole(): void {
  appConsoleStore().dispatch({ type: 'toggle', now: Date.now() })
}
