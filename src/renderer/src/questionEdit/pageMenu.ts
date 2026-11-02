import type { QuestionRef, QuestionUpdateAction } from '@shared/ipc'
import { showUndo, type MenuItem } from '../ui'
import { openQuestionEditor, questionProject } from './open'
import { copyQuestionText, resolveQuestions, updateQuestions } from './ops'
import { questionEditSource } from './source'

/** Acts on the current version of a prompt from a check (it may be an older one). */
async function actOnCurrent(ref: QuestionRef, action: QuestionUpdateAction): Promise<void> {
  const projectId = questionProject()
  if (projectId === null) return
  const source = questionEditSource()
  const { found } = await resolveQuestions(source, projectId, [ref])
  const question = found[0]
  if (!question) {
    showUndo({ message: 'That question is no longer tracked.' })
    return
  }
  if (action === 'disable' && !question.enabled) {
    showUndo({ message: 'It is left out of checks already.' })
    return
  }
  await updateQuestions(source, projectId, action, [
    { sourceId: question.sourceId, promptId: question.promptId }
  ])
}

/**
 * The question items for a prompt row drawn outside the Questions screen (a
 * drill drawer's list): Edit question… · Copy question · Leave out · Remove.
 * Empty when no project is open.
 */
export function promptRowMenu(ref: QuestionRef, text: string): MenuItem[] {
  if (questionProject() === null) return []
  return [
    {
      id: 'q-edit',
      label: 'Edit question…',
      icon: 'pencil',
      onSelect: () => openQuestionEditor(ref)
    },
    {
      id: 'q-copy',
      label: 'Copy question',
      icon: 'copy',
      onSelect: () => void copyQuestionText(text)
    },
    {
      id: 'q-pause',
      label: 'Pause (leave out of checks)',
      icon: 'pause',
      groupStart: true,
      onSelect: () => void actOnCurrent(ref, 'disable')
    },
    {
      id: 'q-remove',
      label: 'Remove',
      icon: 'trash',
      tone: 'danger',
      groupStart: true,
      onSelect: () => void actOnCurrent(ref, 'remove')
    }
  ]
}
