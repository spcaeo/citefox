import type { JSX } from 'react'
import { TOPIC_STAGE_LABEL, TOPIC_STAGES, type TopicStage } from '@shared/domain'
import type { MoveDestination, QuestionRow, QuestionSource } from '@shared/ipc'
import { NOT_IN_TOPIC_LABEL } from '../../topics/clusters'
import { Button, IconButton, MenuButton, type MenuItem } from '../../ui'
import type { TopicChoice } from '../grouping'

/** What the bulk bar can ask the screen to do. Each gets the selection and its `clear`. */
export interface BulkHandlers {
  onMove: (rows: readonly QuestionRow[], to: MoveDestination, clear: () => void) => void
  onNewTopic: (rows: readonly QuestionRow[]) => void
  onSetStage: (rows: readonly QuestionRow[], stage: TopicStage | null, clear: () => void) => void
  onTarget: (rows: readonly QuestionRow[], clear: () => void) => void
  onRecheck: (rows: readonly QuestionRow[]) => void
  onSetEnabled: (rows: readonly QuestionRow[], enabled: boolean, clear: () => void) => void
  onRemove: (rows: readonly QuestionRow[], clear: () => void) => void
  /** Opens the move (or duplicate) drawer for the ticked rows. */
  onMoveMany: (rows: readonly QuestionRow[], mode: 'move' | 'copy', clear: () => void) => void
}

/**
 * The bulk bar while questions are ticked: icons for Move to topic, Set stage, Set
 * target page and Pause, then `⋯` (Duplicate, Resume, Remove), then Check now, the one
 * word button (it spends searches and asks first). Each acts at once; the toast offers Undo.
 */
export function BulkActions({
  selected,
  clear,
  busy,
  topics,
  sources,
  handlers
}: {
  selected: readonly QuestionRow[]
  clear: () => void
  busy: boolean
  topics: readonly TopicChoice[]
  sources: ReadonlyMap<string, QuestionSource>
  handlers: BulkHandlers
}): JSX.Element {
  const anyOn = selected.some((row) => row.enabled)
  const anyOff = selected.some((row) => !row.enabled)
  const inTopic = (row: QuestionRow): boolean => sources.get(row.sourceId)?.kind === 'topic'
  const count = selected.length

  const moveItems: MenuItem[] = [
    ...topics.map((topic): MenuItem => ({
      id: `topic:${topic.id}`,
      label: topic.name,
      hint: topic.count.toLocaleString('en-US'),
      disabled: selected.every((row) => row.sourceId === topic.id),
      onSelect: () => handlers.onMove(selected, { kind: 'topic', topicId: topic.id }, clear)
    })),
    {
      id: 'page',
      label: NOT_IN_TOPIC_LABEL,
      groupStart: topics.length > 0,
      disabled: !selected.some(inTopic),
      onSelect: () => handlers.onMove(selected, { kind: 'page' }, clear)
    },
    {
      id: 'new',
      label: `New topic from these ${count}…`,
      icon: 'plus',
      groupStart: true,
      onSelect: () => handlers.onNewTopic(selected)
    }
  ]

  const stageItems: MenuItem[] = [
    ...TOPIC_STAGES.map((stage): MenuItem => ({
      id: stage,
      label: TOPIC_STAGE_LABEL[stage],
      onSelect: () => handlers.onSetStage(selected, stage, clear)
    })),
    {
      id: 'none',
      label: 'No stage',
      groupStart: true,
      onSelect: () => handlers.onSetStage(selected, null, clear)
    }
  ]

  const moreItems: MenuItem[] = [
    {
      id: 'duplicate',
      label: 'Duplicate to…',
      icon: 'layers',
      onSelect: () => handlers.onMoveMany(selected, 'copy', clear)
    },
    ...(anyOff
      ? [
          {
            id: 'resume',
            label: 'Resume',
            icon: 'play' as const,
            groupStart: true,
            onSelect: () => handlers.onSetEnabled(selected, true, clear)
          }
        ]
      : []),
    {
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      tone: 'danger',
      groupStart: true,
      onSelect: () => handlers.onRemove(selected, clear)
    }
  ]

  return (
    <>
      <MenuButton
        label="Move to topic"
        items={moveItems}
        align="start"
        width={264}
        trigger={({ ref, ...props }) => (
          <IconButton
            ref={ref}
            {...props}
            icon="folder"
            label="Move to topic"
            tip
            size="sm"
            disabled={busy}
          />
        )}
      />
      <MenuButton
        label="Set stage"
        items={stageItems}
        align="start"
        trigger={({ ref, ...props }) => (
          <IconButton
            ref={ref}
            {...props}
            icon="layers"
            label="Set stage"
            tip
            size="sm"
            disabled={busy}
          />
        )}
      />
      <IconButton
        icon="target"
        label="Set target page"
        tip
        size="sm"
        disabled={busy}
        onClick={() => handlers.onTarget(selected, clear)}
      />
      {anyOn ? (
        <IconButton
          icon="pause"
          label="Pause"
          tip
          size="sm"
          disabled={busy}
          onClick={() => handlers.onSetEnabled(selected, false, clear)}
        />
      ) : null}
      <MenuButton
        label="More actions"
        items={moreItems}
        trigger={({ ref, ...props }) => (
          <IconButton ref={ref} {...props} icon="dots" label="More actions" size="sm" />
        )}
      />
      {/* Spends searches: the bar's one word button; it asks with the cost first. */}
      <Button
        size="sm"
        variant="primary"
        icon="refresh"
        disabled={busy || !anyOn}
        onClick={() => handlers.onRecheck(selected)}
      >
        Check now
      </Button>
    </>
  )
}
