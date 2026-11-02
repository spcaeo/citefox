import type { JSX } from 'react'
import type { DrawerEntry } from '../shell/drawerUrl'
import { closeDrawer, currentDrawers, setDrawerParams } from '../shell/drawers'
import { EditQuestionDrawer } from './EditQuestionDrawer'
import { MoveQuestionsDrawer } from './MoveQuestionsDrawer'
import { decodeRefs, type MoveMode } from './open'
import { questionEditSource } from './source'

interface Context {
  entry: DrawerEntry
  depth: number
  projectId: string
}

/** The shell's Edit question drawer (`drawer=question`). */
export function QuestionDrawerFromUrl({ entry, depth, projectId }: Context): JSX.Element | null {
  const promptId = entry.params.question
  const sourceId = entry.params['question.src']
  if (!promptId || !sourceId) return null
  return (
    <EditQuestionDrawer
      key={`${sourceId}~${promptId}`}
      source={questionEditSource()}
      projectId={projectId}
      sourceId={sourceId}
      promptId={promptId}
      tab={entry.params['question.tab'] ?? null}
      onTab={(marketId) => setDrawerParams(depth, { 'question.tab': marketId })}
      onClose={() => closeDrawer(depth)}
    />
  )
}

/** The shell's Move / Duplicate questions drawer (`drawer=move-questions`). */
export function MoveDrawerFromUrl({ entry, depth, projectId }: Context): JSX.Element {
  const mode: MoveMode = entry.params['mq.mode'] === 'copy' ? 'copy' : 'move'
  return (
    <MoveQuestionsDrawer
      key={entry.params['mq.ids'] ?? ''}
      source={questionEditSource()}
      projectId={projectId}
      refs={decodeRefs(entry.params['mq.ids'])}
      mode={mode}
      depth={depth}
      onMode={(next) => setDrawerParams(depth, { 'mq.mode': next })}
      onClose={() => closeDrawer(depth)}
      onDone={() => {
        // A moved question's edit drawer under this one shows an old id: close it too.
        const below = depth > 0 ? currentDrawers()[depth - 1] : undefined
        closeDrawer(below?.id === 'question' && mode === 'move' ? depth - 1 : depth)
      }}
    />
  )
}
