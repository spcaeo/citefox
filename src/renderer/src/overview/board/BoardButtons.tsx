import type { JSX } from 'react'
import { Button, IconButton } from '../../ui'

/**
 * Summary's head tools for the board: the "Edit widgets" icon, and in Edit mode the
 * "Add widget" icon and "Done" (Check now steps aside meanwhile, so there is one
 * primary button). Icons first, the word button last (Docs/DESIGN-GUIDELINES.md).
 */
export function BoardButtons({
  editing,
  onEdit,
  onAdd,
  onDone
}: {
  editing: boolean
  onEdit: () => void
  onAdd: () => void
  onDone: () => void
}): JSX.Element {
  if (!editing) {
    return (
      <IconButton
        icon="grid"
        label="Edit widgets"
        tip
        onClick={onEdit}
        data-testid="summary-edit"
        data-guide="summary-edit"
      />
    )
  }
  return (
    <>
      <IconButton
        icon="plus"
        label="Add widget"
        tip
        onClick={onAdd}
        data-testid="summary-add-widget"
      />
      <Button variant="primary" onClick={onDone} data-testid="summary-edit-done">
        Done
      </Button>
    </>
  )
}
