import { useState, type JSX } from 'react'
import type { PermissionId, PermissionItem } from '@shared/ipc'
import { Button, usePermissions, type ButtonVariant } from '../ui'

/** Actions that can open a system prompt: the user reads what it will say first. */
const ASKS_FIRST: readonly PermissionId[] = ['keychain', 'notifications', 'background', 'loginItem']

export interface PermissionActionParts {
  /** The item's action button, or null when there is nothing to do. */
  button: JSX.Element | null
  /** "What you will see" with Continue and Cancel, while the user confirms. */
  confirm: JSX.Element | null
}

/**
 * One item's action. `setup` opens where it is set up (`onSetup`). `request`
 * runs `permissions:request`, but an action that can open a system prompt
 * first shows the prompt's words and runs only on Continue: CiteFox never
 * triggers an OS prompt without a click and an explanation.
 */
export function usePermissionAction(
  item: PermissionItem,
  onSetup: (id: PermissionId) => void,
  look: {
    variant?: ButtonVariant
    size?: 'sm' | 'md'
    canSetup?: boolean
    /** Opens with "What your computer will show" already up (the grid's button sent the user here). */
    confirmFirst?: boolean
    /** After Continue or Cancel. */
    onDone?: () => void
  } = {}
): PermissionActionParts {
  const permissions = usePermissions()
  const [confirming, setConfirming] = useState(look.confirmFirst === true)
  const action = item.action
  if (action === null || permissions === null) return { button: null, confirm: null }
  if (action.kind === 'setup' && look.canSetup === false) return { button: null, confirm: null }
  const busy = permissions.busy === item.id
  const asksFirst =
    action.kind === 'request' && item.osPrompt !== null && ASKS_FIRST.includes(item.id)
  const confirmId = `pm-confirm-${item.id}`

  function start(): void {
    if (action === null || permissions === null) return
    if (action.kind === 'setup') {
      onSetup(item.id)
      return
    }
    if (asksFirst) {
      setConfirming(true)
      return
    }
    void permissions.request(item.id)
  }

  async function proceed(): Promise<void> {
    await permissions?.request(item.id)
    setConfirming(false)
    look.onDone?.()
  }

  function cancel(): void {
    setConfirming(false)
    look.onDone?.()
  }

  const showConfirm = confirming && asksFirst
  const button = showConfirm ? null : (
    <Button
      size={look.size ?? 'sm'}
      variant={look.variant ?? 'secondary'}
      busy={busy}
      disabled={permissions.busy !== null && !busy}
      aria-label={`${action.label}: ${item.title}`}
      onClick={start}
    >
      {action.label}
    </Button>
  )

  const confirm = showConfirm ? (
    <div className="pm-confirm" role="group" aria-labelledby={`${confirmId}-title`}>
      <p className="pm-confirm-title" id={`${confirmId}-title`}>
        Before you continue: what your computer will show
      </p>
      <p className="pm-confirm-body">{item.osPrompt}</p>
      <div className="pm-confirm-actions">
        <Button size="sm" variant="secondary" busy={busy} autoFocus onClick={() => void proceed()}>
          Continue
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  ) : null

  return { button, confirm }
}
