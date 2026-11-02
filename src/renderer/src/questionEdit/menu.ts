import { TOPIC_STAGE_LABEL, TOPIC_STAGES, type TopicStage } from '@shared/domain'
import type { QuestionRef } from '@shared/ipc'
import type { MenuItem } from '../ui'

/** One question a row menu acts on. */
export interface MenuQuestion extends QuestionRef {
  text: string
  enabled: boolean
  /** True when it sits in a topic (it has a stage, and can go back to its page). */
  inTopic: boolean
  stage: TopicStage | null
}

/** The row actions a screen supports. A missing handler leaves its item out. */
export interface QuestionMenuHandlers {
  onOpen?: () => void
  onEdit?: () => void
  onEditInline?: () => void
  onCopyText?: () => void
  onDuplicate?: () => void
  onMove?: () => void
  onSetStage?: (stage: TopicStage | null) => void
  onToggle?: () => void
  onRecheck?: () => void
  /** False greys Re-check out (paused, or not in the shown market). */
  canRecheck?: boolean
  onRemove?: () => void
}

/**
 * The standard question row menu (deep audit setup F6), the same order on every
 * screen: Open · Edit… · Edit here · Copy · Duplicate… · Move to… · stages ·
 * Pause or Resume · Re-check · Remove (danger). The stage items show only for a
 * question in a topic (a page's question has no stage of its own).
 */
export function questionMenuItems(
  question: MenuQuestion,
  handlers: QuestionMenuHandlers
): MenuItem[] {
  const items: MenuItem[] = []
  const add = (item: MenuItem | null): void => {
    if (item !== null) items.push(item)
  }
  const { onOpen, onEdit, onEditInline, onCopyText, onDuplicate, onMove, onSetStage } = handlers
  add(onOpen ? { id: 'open', label: 'Open', icon: 'arrow-right', onSelect: onOpen } : null)
  add(onEdit ? { id: 'edit', label: 'Edit question…', icon: 'pencil', onSelect: onEdit } : null)
  add(
    onEditInline
      ? { id: 'edit-inline', label: 'Edit wording here', icon: 'pencil', onSelect: onEditInline }
      : null
  )
  add(
    onCopyText ? { id: 'copy', label: 'Copy question', icon: 'copy', onSelect: onCopyText } : null
  )
  add(
    onDuplicate
      ? {
          id: 'duplicate',
          label: 'Duplicate to…',
          icon: 'layers',
          groupStart: true,
          onSelect: onDuplicate
        }
      : null
  )
  add(
    onMove
      ? {
          id: 'move',
          label: question.inTopic ? 'Move to another topic…' : 'Move to a topic…',
          icon: 'merge',
          groupStart: !onDuplicate,
          onSelect: onMove
        }
      : null
  )
  if (onSetStage && question.inTopic) {
    TOPIC_STAGES.forEach((stage, index) => {
      items.push({
        id: `stage:${stage}`,
        label: `Stage: ${TOPIC_STAGE_LABEL[stage]}`,
        groupStart: index === 0,
        disabled: question.stage === stage,
        onSelect: () => onSetStage(stage)
      })
    })
    if (question.stage !== null) {
      items.push({ id: 'stage:none', label: 'Stage: none', onSelect: () => onSetStage(null) })
    }
  }
  add(
    handlers.onToggle
      ? {
          id: 'toggle',
          label: question.enabled ? 'Pause (leave out of checks)' : 'Resume checks',
          icon: question.enabled ? 'pause' : 'play',
          groupStart: true,
          onSelect: handlers.onToggle
        }
      : null
  )
  add(
    handlers.onRecheck
      ? {
          id: 'recheck',
          label: 'Check now…',
          icon: 'refresh',
          disabled: handlers.canRecheck === false,
          onSelect: handlers.onRecheck
        }
      : null
  )
  add(
    handlers.onRemove
      ? {
          id: 'remove',
          label: 'Remove',
          icon: 'trash',
          tone: 'danger',
          groupStart: true,
          onSelect: handlers.onRemove
        }
      : null
  )
  return items
}
