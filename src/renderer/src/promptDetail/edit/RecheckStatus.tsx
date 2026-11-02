import type { JSX } from 'react'
import { IconButton } from '../../ui'
import type { RecheckState } from './usePromptRecheck'

/**
 * The re-check in line on Prompt detail: progress from `checks:progress` while it
 * runs, then what it used, or the reason it stopped in plain words. The result
 * itself refreshes in place below when the check finishes.
 */
export function RecheckStatus({
  state,
  onDismiss
}: {
  state: RecheckState
  onDismiss: () => void
}): JSX.Element | null {
  if (state.status === 'idle') return null
  if (state.status === 'error') {
    return (
      <div className="pd2-recheck pd2-recheck-error" role="alert">
        <p>
          <strong>The re-check did not run.</strong> {state.message}
        </p>
        <IconButton icon="x" size="sm" label="Dismiss" onClick={onDismiss} />
      </div>
    )
  }
  if (state.status === 'done') {
    return (
      <div className="pd2-recheck" role="status">
        <p>
          Checked in {state.markets}. Used {state.searchesUsed.toLocaleString('en-US')}{' '}
          {state.searchesUsed === 1 ? 'search' : 'searches'}. The result below is the new check.
        </p>
        <IconButton icon="x" size="sm" label="Dismiss" onClick={onDismiss} />
      </div>
    )
  }
  const progress = state.progress
  const done = progress?.done ?? 0
  const total = Math.max(1, progress?.total ?? 1)
  return (
    <div className="pd2-recheck" role="status" aria-live="polite">
      <div className="pd2-recheck-text">
        <p>
          <strong>Checking in {state.markets}…</strong>{' '}
          {progress
            ? `${done} of ${total} done · ${progress.searchesUsed.toLocaleString('en-US')} of up to ${progress.searchesMax.toLocaleString('en-US')} searches used`
            : 'Starting the check.'}
        </p>
        <div
          className="pd2-recheck-bar"
          role="progressbar"
          aria-label="Check progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%` }} />
        </div>
      </div>
    </div>
  )
}
