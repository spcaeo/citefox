import type { JSX, ReactNode } from 'react'
import type { TopicCallInfo } from '@shared/ipc'
import { SuggestionCard, type SuggestionItem } from '../../../ui'
import { aiFootnote, type AiRunState } from '../hooks/useAiRun'

export interface AiCardProps<T> {
  state: AiRunState<T>
  /** Call info of the finished answer, for "Claude · about N s". */
  info?: TopicCallInfo | null
  items?: readonly SuggestionItem[]
  body?: ReactNode
  meta?: ReactNode
  /** Facts to re-check before relying on them. */
  recheckCount?: number
  /** Writes the picked items into the draft. Absent: nothing to apply (Explain). */
  onApply?: (ids: string[]) => void
  applyLabel?: string
  /** Restores the draft as it was before Apply. */
  onUndo?: () => void
}

/**
 * The one suggestion card of a section, fed by `useAiRun`: progress with the
 * expected time, the answer with Apply / Undo / Try again (with an
 * instruction), or the error. Renders nothing while idle.
 */
export function AiCard<T>({
  state,
  info,
  items,
  body,
  meta,
  recheckCount,
  onApply,
  applyLabel,
  onUndo
}: AiCardProps<T>): JSX.Element | null {
  if (state.phase === 'idle') return null
  const status = state.phase === 'running' ? 'running' : state.phase === 'error' ? 'error' : 'ready'
  return (
    <SuggestionCard
      key={`${state.actionId ?? ''}-${state.result ? 'r' : 'p'}`}
      title={state.title}
      status={status}
      progress={state.progress}
      reads={state.reads}
      {...(state.seconds > 0 ? { expectedSeconds: state.seconds } : {})}
      error={state.error}
      {...(meta !== undefined ? { meta } : {})}
      {...(body !== undefined ? { body } : {})}
      {...(items ? { items } : {})}
      {...(recheckCount ? { recheckCount } : {})}
      {...(state.result ? { footnote: aiFootnote(info, state.reads) } : {})}
      {...(onApply ? { onApply } : {})}
      {...(applyLabel ? { applyLabel } : {})}
      {...(onUndo ? { onUndo } : {})}
      onRetry={(instruction) => state.retry(instruction)}
      onClose={state.close}
    />
  )
}
