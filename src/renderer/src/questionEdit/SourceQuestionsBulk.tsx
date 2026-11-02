import { useState, type JSX } from 'react'
import { TOPIC_STAGE_LABEL, TOPIC_STAGES, type IntentStage } from '@shared/domain'
import type { QuestionDetail, QuestionRef } from '@shared/ipc'
import { stageLabel } from '../m3/model'
import { Button, MenuButton, showUndo, type MenuItem } from '../ui'
import { openMoveQuestions } from './open'
import {
  copyQuestionTexts,
  resolveQuestions,
  setBuyerStage,
  setStage,
  updateQuestions
} from './ops'
import type { RecheckRequest } from './recheck'
import { RecheckConfirm } from './RecheckConfirm'
import { questionEditSource, type QuestionEditSource } from './source'

const BUYER_STAGES: readonly IntentStage[] = [
  'problem',
  'solution',
  'trigger',
  'comparison',
  'objection'
]

/** One ticked row of a check: its prompt id in that check and its wording. */
export interface PromptPick {
  promptId: string
  text: string
}

function refsOf(found: readonly QuestionDetail[]): QuestionRef[] {
  return found.map((question) => ({ sourceId: question.sourceId, promptId: question.promptId }))
}

/**
 * The bulk bar's question actions for one page's or topic's results (Results ›
 * Prompts, a topic's To-do): Pause · Check now… (with the search cost) · More:
 * stage, Move, Copy, Resume, Remove. A row from an older check acts on its
 * current version; one no longer tracked is skipped. Each acts at once and the
 * toast offers Undo.
 */
export function SourceQuestionsBulk({
  projectId,
  sourceId,
  topic,
  marketId,
  marketLabel,
  samples,
  picked,
  clear,
  source = questionEditSource()
}: {
  projectId: string
  sourceId: string
  /** A topic's questions have topic stages and can move to another topic. */
  topic: boolean
  marketId: string
  marketLabel: string
  /** Samples per search; null looks it up when a re-check is asked. */
  samples: number | null
  picked: readonly PromptPick[]
  clear: () => void
  source?: QuestionEditSource
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [recheck, setRecheck] = useState<RecheckRequest | null>(null)

  const act = async (
    run: (found: readonly QuestionDetail[]) => Promise<unknown>,
    // The re-check keeps the selection (and this bar) until its dialog closes.
    keep = false
  ): Promise<void> => {
    setBusy(true)
    try {
      const { found } = await resolveQuestions(
        source,
        projectId,
        picked.map((pick) => ({ sourceId, promptId: pick.promptId }))
      )
      if (found.length === 0) {
        showUndo({ message: 'These questions are no longer tracked.' })
        return
      }
      if (!keep) clear()
      await run(found)
    } finally {
      setBusy(false)
    }
  }

  const askRecheck = async (found: readonly QuestionDetail[]): Promise<void> => {
    const live = found.filter((question) => question.enabled)
    const known =
      samples ??
      (await Promise.resolve()
        .then(() => source['questions:list']({ projectId }))
        .then((list) => list.sources.find((item) => item.id === sourceId)?.samples ?? 1)
        .catch(() => 1))
    setRecheck({
      refs: refsOf(live),
      skipped: picked.length - live.length,
      marketId,
      marketLabel,
      samples: new Map([[sourceId, known]])
    })
  }

  const stageItems: MenuItem[] = topic
    ? TOPIC_STAGES.map((stage): MenuItem => ({
        id: `stage:${stage}`,
        label: `Stage: ${TOPIC_STAGE_LABEL[stage]}`,
        onSelect: () =>
          void act((found) =>
            setStage(
              source,
              projectId,
              found.map((question) => ({
                sourceId: question.sourceId,
                promptId: question.promptId,
                previous: question.topicStage
              })),
              stage
            )
          )
      }))
    : BUYER_STAGES.map((stage): MenuItem => ({
        id: `stage:${stage}`,
        label: `Stage: ${stageLabel(stage)}`,
        onSelect: () => void act((found) => setBuyerStage(source, projectId, found, stage))
      }))

  const more: MenuItem[] = [
    ...stageItems,
    {
      id: 'move',
      label: topic ? 'Move to another topic…' : 'Move to a topic…',
      icon: 'merge',
      groupStart: true,
      onSelect: () => void act(async (found) => openMoveQuestions(refsOf(found), 'move'))
    },
    {
      id: 'duplicate',
      label: 'Duplicate to…',
      icon: 'layers',
      onSelect: () => void act(async (found) => openMoveQuestions(refsOf(found), 'copy'))
    },
    {
      id: 'copy',
      label: 'Copy questions',
      icon: 'copy',
      onSelect: () => void copyQuestionTexts(picked.map((pick) => pick.text))
    },
    {
      id: 'resume',
      label: 'Resume checks',
      icon: 'play',
      groupStart: true,
      onSelect: () =>
        void act((found) =>
          updateQuestions(source, projectId, 'enable', refsOf(found.filter((q) => !q.enabled)))
        )
    },
    {
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      tone: 'danger',
      groupStart: true,
      onSelect: () =>
        void act((found) => updateQuestions(source, projectId, 'remove', refsOf(found)))
    }
  ]

  return (
    <>
      <Button
        size="sm"
        icon="pause"
        busy={busy}
        onClick={() =>
          void act((found) =>
            updateQuestions(source, projectId, 'disable', refsOf(found.filter((q) => q.enabled)))
          )
        }
      >
        {topic ? 'Pause' : 'Leave out'}
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() => void act(askRecheck, true)}
      >
        Check now…
      </Button>
      <MenuButton
        label="More question actions"
        items={more}
        align="start"
        trigger={({ ref, ...props }) => (
          <Button ref={ref} {...props} size="sm" iconEnd="chevron-down" disabled={busy}>
            More
          </Button>
        )}
      />
      {recheck ? (
        <RecheckConfirm
          source={source}
          projectId={projectId}
          request={recheck}
          onClose={() => {
            setRecheck(null)
            clear()
          }}
        />
      ) : null}
    </>
  )
}
