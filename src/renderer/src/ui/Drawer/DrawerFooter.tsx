import type { JSX } from 'react'
import { Button } from '../Button'
import type { DrawerAction, DrawerFooterSpec } from './types'

function ActionButton({
  action,
  variant
}: {
  action: DrawerAction
  variant: NonNullable<DrawerAction['variant']>
}): JSX.Element {
  return (
    <Button
      variant={action.variant ?? variant}
      icon={action.icon}
      iconEnd={action.iconEnd}
      busy={action.busy}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      data-testid={action.testId}
      data-guide={action.guide}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  )
}

/**
 * The drawer's footer: always there, so Close sits in the same place on every
 * drawer. The summary says what will happen and what it costs; the buttons
 * are Cancel, at most one secondary, and the one primary at the far right.
 */
export function DrawerFooter({
  spec,
  onCancel,
  cancelDisabled
}: {
  spec: DrawerFooterSpec
  onCancel: () => void
  cancelDisabled: boolean
}): JSX.Element {
  const { summary, secondary, primary, danger } = spec
  const cancelLabel =
    spec.cancel === false ? null : (spec.cancel ?? (primary || secondary ? 'Cancel' : 'Close'))
  return (
    <div className="ui-drawer-foot">
      {danger ? (
        <div className="ui-drawer-foot-danger">
          <ActionButton action={danger} variant="ghost" />
        </div>
      ) : null}
      <div className="ui-drawer-foot-summary" role="status">
        {summary}
      </div>
      <div className="ui-drawer-foot-actions">
        {cancelLabel !== null ? (
          <Button
            variant="secondary"
            disabled={cancelDisabled}
            onClick={onCancel}
            data-drawer-cancel=""
          >
            {cancelLabel}
          </Button>
        ) : null}
        {secondary ? <ActionButton action={secondary} variant="secondary" /> : null}
        {primary ? <ActionButton action={primary} variant="primary" /> : null}
      </div>
    </div>
  )
}
