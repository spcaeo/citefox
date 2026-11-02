import { navigateHash } from '../../../shell/routes'
import type { MenuItem } from '../../../ui'
import type { TopicAction, TopicLine } from '../model'

/** The row and bulk actions that act at once (each shows Undo in the toast). */
export interface TopicGridActions {
  onSettings: (line: TopicLine) => void
  onRename: (line: TopicLine, name: string) => Promise<void>
  onPause: (lines: readonly TopicLine[], paused: boolean) => void
  onDuplicate: (lines: readonly TopicLine[]) => void
  onRemove: (lines: readonly TopicLine[]) => void
  onMergeInto: (lines: readonly TopicLine[], into: TopicLine) => void
  /** Opens the Check now drawer on these topics (it shows the cost before anything runs). */
  onCheckNow: (lines: readonly TopicLine[]) => void
  /** Opens Move to folder for these topics (`drawer=topic-folder&tf.mode=move`). */
  onMoveToFolder: (lines: readonly TopicLine[]) => void
}

/**
 * A topic row's ⋯ menu, the same in the Tree and the List: Open, Add questions, Check
 * now; then editing the topic, Move to folder, Merge and Split; Pause or Resume; Delete.
 */
export function topicRowMenu(
  line: TopicLine,
  options: {
    onOpen: (line: TopicLine) => void
    onEdit: (topicId: string) => void
    onAction: (action: TopicAction, line: TopicLine) => void
    actions: TopicGridActions
    addQuestionsHref: (line: TopicLine) => string
  }
): readonly MenuItem[] {
  const { onOpen, onEdit, onAction, actions, addQuestionsHref } = options
  return [
    { id: 'open', label: 'Open', icon: 'external', onSelect: () => onOpen(line) },
    {
      id: 'add',
      label: 'Add questions',
      icon: 'plus',
      onSelect: () => navigateHash(addQuestionsHref(line))
    },
    {
      id: 'check',
      label: 'Check now…',
      icon: 'refresh',
      disabled: line.questionRows.length === 0,
      onSelect: () => actions.onCheckNow([line])
    },
    {
      id: 'settings',
      label: 'Edit topic…',
      icon: 'sliders',
      groupStart: true,
      onSelect: () => actions.onSettings(line)
    },
    { id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => onEdit(line.id) },
    {
      id: 'folder',
      label: 'Move to folder…',
      icon: 'folder',
      onSelect: () => actions.onMoveToFolder([line])
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      onSelect: () => actions.onDuplicate([line])
    },
    {
      id: 'merge',
      label: 'Merge into another topic…',
      icon: 'merge',
      onSelect: () => onAction('merge', line)
    },
    {
      id: 'split',
      label: 'Split by stage…',
      icon: 'layers',
      disabled: line.stages < 2,
      onSelect: () => onAction('split', line)
    },
    line.status === 'paused'
      ? {
          id: 'resume',
          label: 'Resume checks',
          icon: 'play',
          groupStart: true,
          onSelect: () => actions.onPause([line], false)
        }
      : {
          id: 'pause',
          label: 'Pause checks',
          icon: 'pause',
          groupStart: true,
          onSelect: () => actions.onPause([line], true)
        },
    {
      id: 'delete',
      label: 'Delete topic',
      icon: 'trash',
      tone: 'danger',
      groupStart: true,
      onSelect: () => actions.onRemove([line])
    }
  ]
}
