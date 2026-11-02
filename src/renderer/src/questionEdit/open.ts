import type { QuestionRef } from '@shared/ipc'
import { drawerHref, openDrawer } from '../shell/drawers'

/** `mq.mode`: move to a topic, or copy into any page or topic. */
export type MoveMode = 'move' | 'copy'

/** Separates a source id from a prompt id in `mq.ids` (both opaque ids). */
const PAIR = '~'

/** `page-1~prompt-2,topic-3~prompt-9`: the refs on the URL. */
export function encodeRefs(refs: readonly QuestionRef[]): string {
  return refs.map((ref) => `${ref.sourceId}${PAIR}${ref.promptId}`).join(',')
}

export function decodeRefs(value: string | null | undefined): QuestionRef[] {
  if (!value) return []
  return value.split(',').flatMap((part) => {
    const at = part.indexOf(PAIR)
    if (at <= 0 || at === part.length - 1) return []
    return [{ sourceId: part.slice(0, at), promptId: part.slice(at + 1) }]
  })
}

/** Opens one question's edit drawer over the current screen. */
export function openQuestionEditor(ref: QuestionRef, tab?: string): void {
  openDrawer('question', {
    question: ref.promptId,
    'question.src': ref.sourceId,
    'question.tab': tab ?? null
  })
}

/** The link that opens one question's edit drawer over the current screen. */
export function questionEditorHref(ref: QuestionRef): string {
  return drawerHref('question', { question: ref.promptId, 'question.src': ref.sourceId })
}

/** Opens the move (or copy) drawer for these questions. */
export function openMoveQuestions(refs: readonly QuestionRef[], mode: MoveMode = 'move'): void {
  if (refs.length === 0) return
  openDrawer('move-questions', { 'mq.ids': encodeRefs(refs), 'mq.mode': mode })
}

let activeProject: string | null = null

/** The open project, for row actions drawn outside a screen (drill drawers). */
export function questionProject(): string | null {
  return activeProject
}

export function setQuestionProject(projectId: string | null): void {
  activeProject = projectId
}
