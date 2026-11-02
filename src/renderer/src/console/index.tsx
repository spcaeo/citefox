import { useEffect, useMemo, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { appConsoleStore } from './host'
import { WorkConsole } from './WorkConsole'

/**
 * The app-wide work console (src/renderer/src/console). The app renders
 * `<WorkConsoleHost />` once; the top bar's Activity button toggles it.
 *
 * Its open or minimised state is not in the URL: it floats over every route, and
 * a route change must not close it. Where it was dragged, "Close when done" and
 * whether new work opens the window or the pill are saved per user instead.
 *
 * `quiet` while the first-run setup shows: its steps show their own progress,
 * so new work waits behind the Activity button instead of covering them.
 */
export function WorkConsoleHost({ quiet = false }: { quiet?: boolean }): JSX.Element {
  const shared = useMemo(() => appConsoleStore(), [])
  useEffect(() => {
    shared.dispatch({ type: 'setQuiet', value: quiet })
  }, [shared, quiet])
  // Portalled to the body: the shell's panes are their own stacking contexts.
  return createPortal(<WorkConsole store={shared} />, document.body)
}
