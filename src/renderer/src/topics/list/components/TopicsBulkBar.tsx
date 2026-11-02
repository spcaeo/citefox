import type { JSX } from 'react'
import { Button, IconButton, MenuButton, type MenuItem } from '../../../ui'
import type { TopicLine } from '../model'
import type { TopicGridActions } from './topicMenu'

/**
 * The Topics bulk bar (deep audit TL-C4): what the row menu does, for every
 * ticked topic at once. Each action clears the ticks and shows Undo in the
 * toast; Merge into lists every topic, ticked or not, as the destination.
 * Check now opens the Check now drawer on the ticked topics (cost shown there).
 * Resume, Duplicate and Delete are under ⋯.
 */
export function TopicsBulkBar({
  selected,
  lines,
  busy,
  clear,
  actions
}: {
  selected: readonly TopicLine[]
  lines: readonly TopicLine[]
  busy: boolean
  clear: () => void
  actions: TopicGridActions
}): JSX.Element {
  const paused = selected.filter((line) => line.status === 'paused')
  const running = selected.filter((line) => line.status !== 'paused')
  const run = (act: () => void): void => {
    clear()
    act()
  }
  const into: MenuItem[] = lines.map((line) => ({
    id: line.id,
    label: line.name,
    ...(selected.some((item) => item.id === line.id) ? { hint: 'ticked' } : {}),
    disabled: selected.length === 1 && selected[0]?.id === line.id,
    onSelect: () => run(() => actions.onMergeInto(selected, line))
  }))
  // Resume, Duplicate and Delete sit behind ⋯ (as on Questions), so the bar
  // stays on one line in the narrow window.
  const more: MenuItem[] = [
    {
      id: 'resume',
      label: 'Resume checks',
      icon: 'play',
      disabled: busy || paused.length === 0,
      onSelect: () => run(() => actions.onPause(paused, false))
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      disabled: busy,
      onSelect: () => run(() => actions.onDuplicate(selected))
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'trash',
      tone: 'danger',
      groupStart: true,
      disabled: busy,
      onSelect: () => run(() => actions.onRemove(selected))
    }
  ]
  return (
    <>
      <IconButton
        icon="pause"
        label="Pause checks"
        tip
        size="sm"
        disabled={busy || running.length === 0}
        onClick={() => run(() => actions.onPause(running, true))}
      />
      <IconButton
        icon="folder"
        label="Move to folder"
        tip
        size="sm"
        disabled={busy}
        onClick={() => run(() => actions.onMoveToFolder(selected))}
      />
      <MenuButton
        label="Merge the ticked topics into"
        items={into}
        width={280}
        header={<span className="tl-bulk-menu-head">Questions move with their history.</span>}
        trigger={(props) => (
          <IconButton
            {...props}
            icon="merge"
            label="Merge into"
            tip
            size="sm"
            disabled={busy || lines.length < 2}
          />
        )}
      />
      <MenuButton
        label="More topic actions"
        items={more}
        trigger={({ ref, ...props }) => (
          <IconButton ref={ref} {...props} icon="dots" label="More topic actions" size="sm" />
        )}
      />
      {/* Spends searches (the drawer shows the cost): the bar's one word button. */}
      <Button
        size="sm"
        variant="primary"
        icon="refresh"
        disabled={busy}
        onClick={() => run(() => actions.onCheckNow(selected))}
      >
        Check now
      </Button>
    </>
  )
}
