import { useId, useRef, type JSX, type ReactNode } from 'react'
import { useDialog } from '../components/useDialog'
import { Button } from './Button'

export interface ConfirmProps {
  /** The question, such as "Discard changes?" or "Delete this topic?". */
  title: string
  /** One or two plain sentences on what happens. */
  body?: ReactNode
  /** Verb + object, such as "Discard" or "Delete topic". */
  confirmLabel: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** `danger` paints the confirm button red (destructive). Default `danger`. */
  tone?: 'danger' | 'default'
  /** Shows a busy confirm button while the action runs. */
  busy?: boolean
  /** Holds the confirm button until the body's check passes (a typed name). */
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Test id on the dialog. */
  testId?: string
}

/**
 * The one small confirm (deep audit §2.7 `ConfirmDialog`): a 440-wide centred
 * alertdialog over everything, drawers included, for a single destructive
 * decision. It never grows into a form; anything with fields is a Drawer.
 * Focus starts on the safe button, Escape cancels, and focus goes back to
 * whatever asked.
 */
export function Confirm({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  testId
}: ConfirmProps): JSX.Element {
  const titleId = useId()
  const bodyId = useId()
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const ref = useDialog<HTMLDivElement>({
    onClose: () => {
      if (!busy) onCancel()
    },
    initialFocus: cancelRef
  })
  return (
    <div
      className="ui-confirm-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={ref}
        className="ui-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        data-testid={testId}
      >
        <h2 id={titleId} className="ui-confirm-title">
          {title}
        </h2>
        {body ? (
          <div id={bodyId} className="ui-confirm-body">
            {body}
          </div>
        ) : null}
        <div className="ui-confirm-actions">
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            busy={busy}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
