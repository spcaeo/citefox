import { useEffect, useState } from 'react'
import type { QuestionDetail, QuestionRef } from '@shared/ipc'
import { copyText } from '../components/clipboard'
import { onTopicsChanged } from '../topics/clusters'
import { showUndo, type MenuItem } from '../ui'
import { questionMenuItems } from './menu'
import { openMoveQuestions, openQuestionEditor } from './open'
import { copyQuestionText, setStage, updateQuestions } from './ops'
import { questionEditSource, type QuestionEditSource } from './source'

/**
 * The question's own actions for a screen that shows one question (Prompt
 * detail's More): Edit details · Copy question · Copy overview text · Duplicate
 * to another page · Move to a topic · Stage · Leave out or Resume · Remove. Each
 * acts at once and the toast offers Undo. Empty until the question has loaded
 * (and for a prompt that is no longer in the active version).
 */
export function useQuestionItems({
  projectId,
  question,
  text,
  overviewText,
  source = questionEditSource()
}: {
  projectId: string
  question: QuestionRef
  /** The wording shown, for Copy question. */
  text: string
  /** The AI Overview text shown, for Copy overview text; null leaves it out. */
  overviewText: string | null
  source?: QuestionEditSource
}): MenuItem[] {
  const [detail, setDetail] = useState<QuestionDetail | null>(null)
  const [version, setVersion] = useState(0)
  const { sourceId, promptId } = question

  useEffect(() => onTopicsChanged(() => setVersion((n) => n + 1)), [])

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => source['questions:get']({ projectId, sourceId, promptId }))
      .then(
        (loaded) => {
          if (!cancelled) setDetail(loaded.active ? loaded : null)
        },
        // No question behind this prompt (an older version, or removed): no items.
        () => {
          if (!cancelled) setDetail(null)
        }
      )
    return () => {
      cancelled = true
    }
  }, [source, projectId, sourceId, promptId, version])

  if (detail === null) return []
  const ref = { sourceId: detail.sourceId, promptId: detail.promptId }
  const inTopic = detail.sourceKind === 'topic'
  const items = questionMenuItems(
    { ...ref, text, enabled: detail.enabled, inTopic, stage: detail.topicStage },
    {
      onCopyText: () => void copyQuestionText(text),
      onDuplicate: () => openMoveQuestions([ref], 'copy'),
      onMove: () => openMoveQuestions([ref], 'move'),
      onSetStage: (stage) =>
        void setStage(source, projectId, [{ ...ref, previous: detail.topicStage }], stage),
      onToggle: () =>
        void updateQuestions(source, projectId, detail.enabled ? 'disable' : 'enable', [ref]),
      onRemove: () => void updateQuestions(source, projectId, 'remove', [ref])
    }
  )
  const extra: MenuItem[] = [
    {
      id: 'edit-details',
      label: 'Edit details…',
      icon: 'pencil',
      groupStart: true,
      onSelect: () => openQuestionEditor(ref)
    }
  ]
  if (overviewText) {
    extra.push({
      id: 'copy-overview',
      label: 'Copy overview text',
      icon: 'copy',
      onSelect: () =>
        void copyText(overviewText).then((ok) =>
          showUndo({ message: ok ? 'Copied the overview text.' : 'Could not copy the text.' })
        )
    })
  }
  // A page's question has its buyer stage in the drawer; a topic's stages are in the menu.
  if (!inTopic) {
    extra.push({
      id: 'stage',
      label: 'Change stage…',
      icon: 'sliders',
      onSelect: () => openQuestionEditor(ref)
    })
  }
  const copyAt = items.findIndex((item) => item.id === 'copy')
  return [
    ...extra.slice(0, 1),
    ...items.slice(0, copyAt + 1),
    ...extra.slice(1),
    ...items.slice(copyAt + 1)
  ]
}
