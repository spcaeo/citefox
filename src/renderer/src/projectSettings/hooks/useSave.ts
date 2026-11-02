import { useCallback, useState } from 'react'
import type { SaveState } from '../types'
import { errorText } from '../utils/model'

/** Runs one save and keeps its outcome for the section's status line. */
export function useSave(): {
  state: SaveState
  run: (action: () => Promise<void>, saved: string | (() => string)) => Promise<boolean>
  fail: (text: string) => void
  reset: () => void
} {
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const run = useCallback(async (action: () => Promise<void>, saved: string | (() => string)) => {
    setState({ kind: 'saving' })
    try {
      await action()
      setState({ kind: 'saved', text: typeof saved === 'string' ? saved : saved() })
      return true
    } catch (cause) {
      setState({ kind: 'error', text: errorText(cause) })
      return false
    }
  }, [])
  const fail = useCallback((text: string) => setState({ kind: 'error', text }), [])
  const reset = useCallback(() => setState({ kind: 'idle' }), [])
  return { state, run, fail, reset }
}
