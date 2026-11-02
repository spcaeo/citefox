import type { ReactNode } from 'react'
import {
  TOPIC_STAGES,
  TOPIC_STAGE_HINT,
  TOPIC_STAGE_LABEL,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import type { ListColumn, ListGroup } from '../../../ui'
import { InCheckChip } from './questionGrid'

/** "Q6" numbers: position among the draft's questions, 1-based. */
export function questionNumbers(questions: readonly TopicDraftPrompt[]): Map<string, number> {
  return new Map(questions.map((question, index) => [question.id, index + 1]))
}

/** Competitor names without their TLD ("simpletexting.com" → "simpletexting"). */
export function rivalNames(competitors: readonly string[]): string[] {
  return competitors
    .map((name) => name.replace(/\.[a-z.]+$/i, ''))
    .filter((name) => name.length > 2)
}

export function numberColumn(numbers: ReadonlyMap<string, number>): ListColumn<TopicDraftPrompt> {
  return {
    id: 'q',
    label: 'Q',
    width: 64,
    sort: (row) => numbers.get(row.id) ?? 0,
    render: (row) => <span className="tw-qnum num">Q{numbers.get(row.id) ?? '–'}</span>
  }
}

export function textColumn(label = 'Question'): ListColumn<TopicDraftPrompt> {
  return {
    id: 'text',
    label,
    width: 'fill',
    minWidth: 280,
    sort: (row) => row.text,
    render: (row) => (
      <span className={row.included ? 'tw-clamp' : 'tw-clamp tw-out'} title={row.text}>
        {row.text}
      </span>
    )
  }
}

export function inCheckColumn(label = 'In check'): ListColumn<TopicDraftPrompt> {
  return {
    id: 'in',
    label,
    width: 112,
    sort: (row) => (row.included ? 1 : 0),
    render: (row) => <InCheckChip included={row.included} />
  }
}

/** Groups questions by journey stage, in journey order, with "6 of 6" style meta. */
export function stageGroup(
  meta?: (rows: readonly TopicDraftPrompt[], stage: TopicStage) => ReactNode
): ListGroup<TopicDraftPrompt> {
  return {
    key: (row) => {
      const stage = row.stage ?? 'problem'
      return { key: stage, label: TOPIC_STAGE_LABEL[stage] }
    },
    order: TOPIC_STAGES,
    meta: (rows, key) =>
      meta ? meta(rows, key as TopicStage) : TOPIC_STAGE_HINT[key as TopicStage]
  }
}

export const STAGE_CHOICES = TOPIC_STAGES.map((stage) => ({
  value: stage,
  label: TOPIC_STAGE_LABEL[stage]
}))
