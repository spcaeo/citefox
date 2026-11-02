import type { JSX } from 'react'
import {
  TOPIC_STAGES,
  TOPIC_STAGE_LABEL,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import { Button, Chip, MenuButton, type MenuItem } from '../../../ui'
import { namesAny } from '../utils/text'

export function QuestionFlags({
  prompt,
  numbers,
  rivals
}: {
  prompt: TopicDraftPrompt
  numbers: ReadonlyMap<string, number>
  rivals: readonly string[]
}): JSX.Element {
  const overlap = prompt.overlapWith
    .map((id) => numbers.get(id))
    .filter((n): n is number => n !== undefined)
  return (
    <span className="tw-flags">
      {overlap.length > 0 ? (
        <Chip tone="info" size="sm" label="Overlaps with">
          {overlap.map((n) => `Q${n}`).join(', ')}
        </Chip>
      ) : null}
      {prompt.flags.includes('brand') ? (
        <Chip tone="warn" size="sm">
          Names your brand
        </Chip>
      ) : null}
      {prompt.flags.includes('short') ? <Chip size="sm">Very short</Chip> : null}
      {prompt.flags.includes('merged') ? (
        <Chip tone="info" size="sm">
          {prompt.mergedFrom.length + 1} merged
        </Chip>
      ) : null}
      {namesAny(prompt.text, rivals) ? <Chip size="sm">Names a rival</Chip> : null}
    </span>
  )
}

export function InCheckChip({ included }: { included: boolean }): JSX.Element {
  return included ? (
    <Chip tone="ok" size="sm">
      Included
    </Chip>
  ) : (
    <span className="tw-muted">Left out</span>
  )
}

/** A bulk-bar button that opens a stage menu ("Move to stage"). */
export function StageMenuButton({
  label = 'Move to stage',
  onPick
}: {
  label?: string
  onPick: (stage: TopicStage) => void
}): JSX.Element {
  const items: MenuItem[] = TOPIC_STAGES.map((stage) => ({
    id: stage,
    label: TOPIC_STAGE_LABEL[stage],
    onSelect: () => onPick(stage)
  }))
  return (
    <MenuButton
      label={label}
      items={items}
      align="start"
      trigger={({ ref, ...rest }, open) => (
        <Button
          ref={ref}
          size="sm"
          icon="layers"
          iconEnd={open ? 'chevron-up' : 'chevron-down'}
          {...rest}
        >
          {label}
        </Button>
      )}
    />
  )
}
