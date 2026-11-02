import { useCallback, useState } from 'react'
import type { VideoIdea } from '@shared/domain'
import { IDLE, type ActionState } from '../types'
import { plainError } from '../utils/model'

/**
 * Runs one idea action (a `videos:*` call), keeps its busy and message state,
 * and hands the returned idea back to the screen.
 */
export function useIdeaAction(
  onIdea: (idea: VideoIdea) => void
): [ActionState, (run: () => Promise<VideoIdea>, done?: string) => Promise<void>, () => void] {
  const [state, setState] = useState<ActionState>(IDLE)
  const run = useCallback(
    async (call: () => Promise<VideoIdea>, done?: string) => {
      setState({ busy: true, message: null, error: false })
      try {
        const idea = await call()
        onIdea(idea)
        setState({ busy: false, message: done ?? null, error: false })
      } catch (cause) {
        setState({ busy: false, message: plainError(cause, 'That did not work.'), error: true })
      }
    },
    [onIdea]
  )
  const reset = useCallback(() => setState(IDLE), [])
  return [state, run, reset]
}
