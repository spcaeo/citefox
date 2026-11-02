import type { StartProgress } from '@shared/ipc'
import { progressHint } from '../assist/progress'
import { emitMainEvent } from '../ipc-events'

/**
 * The autopilot's live snapshot, pushed as `start:changed`. It also feeds the
 * shared `assist:progress` stream (owner feedback 1): `start:homework` runs
 * inside a progress run, so its page reads and Claude calls already push their
 * own steps; the running step's detail ("Reading /pricing") becomes the line
 * under the next Claude step. Outside an invoke the hint is a no-op.
 */
export function emitStartProgress(event: StartProgress): void {
  const running = event.items.find((item) => item.state === 'running')
  if (event.phase === 'running' && running !== undefined) {
    progressHint(running.detail ? `${running.label}: ${running.detail}` : running.label)
  }
  emitMainEvent('start:changed', event)
}
