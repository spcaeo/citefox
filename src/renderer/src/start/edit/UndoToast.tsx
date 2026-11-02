import { useEffect, type JSX } from 'react'
import { Button } from '../../ui'
import './edit.css'

/** How long the toast stays. */
export const TOAST_MS = 6000

/**
 * "Removed competitor PagerDuty · Undo": a bottom-centre toast after each edit,
 * with the follow-up CiteFox made on a second line. It hides after six seconds.
 */
export function UndoToast({
  message,
  effect,
  onUndo,
  onClose,
  undoing = false
}: {
  message: string
  effect: string | null
  onUndo: (() => void) | null
  onClose: () => void
  undoing?: boolean
}): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(onClose, TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [message, onClose])

  return (
    <div className="ed-toast" role="status" aria-live="polite">
      <div className="ed-toast-text">
        <span>{message}</span>
        {effect ? <span className="ed-toast-effect">{effect}</span> : null}
      </div>
      {onUndo ? (
        <Button size="sm" busy={undoing} disabled={undoing} onClick={onUndo}>
          Undo
        </Button>
      ) : null}
      <button type="button" className="ed-toast-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
