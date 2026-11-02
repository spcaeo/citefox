import type { DragEvent, JSX, ReactNode } from 'react'
import type { MoveDestination, QuestionRef } from '@shared/ipc'
import { parseDestination } from '../grouping'
import { DRAG_TYPE, readRefs } from '../utils/drag'

/** The group header under the pointer and where a drop there moves to, or null. */
function dropTarget(
  event: DragEvent<HTMLElement>
): { header: HTMLElement; to: MoveDestination } | null {
  const header = (event.target as HTMLElement | null)?.closest<HTMLElement>('.ui-lg-group')
  const value = header?.querySelector<HTMLElement>('[data-move-target]')?.dataset.moveTarget
  if (!header || value === undefined) return null
  const to = parseDestination(value)
  return to === null ? null : { header, to }
}

function clearHighlight(root: HTMLElement): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-drop-over]')) {
    delete node.dataset.dropOver
  }
}

/**
 * Drag a question onto a topic heading to move it. The grid is the shared kit, so this
 * wrapper listens on its parent: a drag over a group header that carries a
 * `data-move-target` (topic groups and "Not in a topic", in Topic grouping only) is
 * marked with `data-drop-over` and a drop there calls `onDrop`.
 */
export function DropZone({
  enabled,
  onDrop,
  children
}: {
  enabled: boolean
  onDrop: (refs: readonly QuestionRef[], to: MoveDestination) => void
  children: ReactNode
}): JSX.Element {
  if (!enabled) return <>{children}</>
  return (
    <div
      className="qs-drop"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
        const target = dropTarget(event)
        clearHighlight(event.currentTarget)
        if (target === null) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        target.header.dataset.dropOver = 'true'
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget as Node | null
        if (next === null || !event.currentTarget.contains(next)) {
          clearHighlight(event.currentTarget)
        }
      }}
      onDrop={(event) => {
        clearHighlight(event.currentTarget)
        const target = dropTarget(event)
        if (target === null) return
        event.preventDefault()
        const refs = readRefs(event)
        if (refs.length > 0) onDrop(refs, target.to)
      }}
      onDragEnd={(event) => clearHighlight(event.currentTarget)}
    >
      {children}
    </div>
  )
}
