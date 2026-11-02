import { useMemo, type JSX } from 'react'
import type { StartClient } from '../start/client'
import { ActivityControl } from '../start/ActivityPanel'
import { appConsoleStore } from './host'
import { useConsoleState } from './useConsoleState'

/**
 * The top bar's Activity button, opening the work console (owner: reopen the
 * console from the top bar). The Activity list is the `drawer=activity` drawer.
 */
export function ConsoleActivityButton({ client }: { client: StartClient }): JSX.Element {
  const store = useMemo(() => appConsoleStore(), [])
  const state = useConsoleState(store)
  return (
    <ActivityControl
      client={client}
      expanded={state.mode === 'open'}
      onToggle={() => store.dispatch({ type: 'toggle', now: Date.now() })}
    />
  )
}
