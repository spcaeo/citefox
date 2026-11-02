import type { DragEvent } from 'react'
import type { QuestionRef } from '@shared/ipc'

/** The drag payload type: the dragged questions as JSON `QuestionRef[]`. */
export const DRAG_TYPE = 'application/x-citefox-questions'

/** Starts dragging questions: the row, or the whole selection when the row is in it. */
export function startDrag(event: DragEvent<HTMLElement>, refs: readonly QuestionRef[]): void {
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(refs))
  event.dataTransfer.effectAllowed = 'move'
}

/** The dragged questions, or none when the payload is not ours. */
export function readRefs(event: DragEvent<HTMLElement>): QuestionRef[] {
  try {
    const value: unknown = JSON.parse(event.dataTransfer.getData(DRAG_TYPE))
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is QuestionRef =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as QuestionRef).sourceId === 'string' &&
        typeof (item as QuestionRef).promptId === 'string'
    )
  } catch {
    return []
  }
}
