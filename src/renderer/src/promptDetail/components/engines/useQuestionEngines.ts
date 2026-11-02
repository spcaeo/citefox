import { useEffect, useState } from 'react'
import { isEngineId, type EngineId } from '@shared/domain'
import type { EngineAnswerView, QuestionEnginesRequest, QuestionEnginesView } from '@shared/ipc'

/** `engines:question`, as Prompt detail's source may offer it. */
export type QuestionEnginesChannel = (
  request: QuestionEnginesRequest
) => Promise<QuestionEnginesView>

/**
 * The engine tabs a question shows: Google AI Overview (today's detail), then each other
 * engine the page checks or has answered before. Fewer than two: no tabs at all.
 */
export function engineTabs(view: QuestionEnginesView | null): EngineAnswerView[] {
  if (view === null) return []
  const google = view.engines.find((answer) => answer.engine === 'google_aio')
  const others = view.engines.filter(
    (answer) => answer.engine !== 'google_aio' && (answer.selected || answer.status !== null)
  )
  if (others.length === 0 || google === undefined) return []
  return [google, ...others]
}

/** The tab a URL value names, when the question has it; else Google AI Overview. */
export function engineTabOf(value: string | null, tabs: readonly EngineAnswerView[]): EngineId {
  return isEngineId(value) && tabs.some((tab) => tab.engine === value) ? value : 'google_aio'
}

/**
 * The question's latest answer on each engine. Without the channel, or when the read
 * fails, there is nothing: the detail stays Google AI Overview's, as it was.
 */
export function useQuestionEngines(
  channel: QuestionEnginesChannel | undefined,
  request: QuestionEnginesRequest
): QuestionEnginesView | null {
  const [view, setView] = useState<QuestionEnginesView | null>(null)
  const { projectId, pageId, promptId, marketId = null } = request
  useEffect(() => {
    if (channel === undefined) return
    let live = true
    channel({ projectId, pageId, promptId, marketId })
      .then((next) => {
        if (live) setView(next)
      })
      .catch(() => {
        if (live) setView(null)
      })
    return () => {
      live = false
    }
  }, [channel, projectId, pageId, promptId, marketId])
  return view
}
