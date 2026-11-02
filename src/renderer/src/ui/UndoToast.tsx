import { useEffect, type JSX } from 'react'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { hideUndo, runUndo, UNDO_TOAST_MS, useUndoToast } from './undoStore'

/**
 * Draws the latest `showUndo` toast at the bottom centre, over drawers. It
 * hides after ten seconds, a moment after Undo works, or on ✕. A failed Undo
 * stays until it is closed, so the reason can be read.
 */
export function UndoToastHost(): JSX.Element | null {
  const toast = useUndoToast()
  const id = toast?.id ?? null
  const phase = toast?.phase ?? null

  useEffect(() => {
    if (id === null || phase === 'undoing' || phase === 'failed') return
    const timer = window.setTimeout(() => hideUndo(id), phase === 'undone' ? 2500 : UNDO_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [id, phase])

  if (toast === null) return null
  const { spec } = toast
  const text =
    toast.phase === 'undone'
      ? (spec.undoneMessage ?? 'Undone.')
      : toast.phase === 'failed'
        ? (toast.error ?? 'Could not undo.')
        : spec.message
  const canUndo = Boolean(spec.undo) && (toast.phase === 'shown' || toast.phase === 'undoing')
  return (
    <div
      className="ui-undo-toast"
      role="status"
      aria-live="polite"
      data-testid={spec.testId ?? 'undo-toast'}
      data-phase={toast.phase}
    >
      <div className="ui-undo-toast-text">
        <span>{text}</span>
        {spec.effect && toast.phase === 'shown' ? (
          <span className="ui-undo-toast-effect">{spec.effect}</span>
        ) : null}
      </div>
      {canUndo ? (
        <Button
          size="sm"
          variant="secondary"
          busy={toast.phase === 'undoing'}
          disabled={toast.phase === 'undoing'}
          onClick={() => void runUndo(toast.id)}
        >
          {spec.undoLabel ?? 'Undo'}
        </Button>
      ) : null}
      <IconButton
        icon="x"
        size="sm"
        label="Close message"
        className="ui-undo-toast-close"
        onClick={() => hideUndo(toast.id)}
      />
    </div>
  )
}
