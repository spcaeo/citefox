import { useCallback, useEffect, useState, type FocusEvent } from 'react'
import { copyText } from '../components/clipboard'
import { announce } from './announce'

/** How long the copy icon shows a tick (or a cross when the copy failed). */
export const COPIED_MS = 1500

export type CopyState = 'idle' | 'copied' | 'failed'

export interface CopyFeedback {
  state: CopyState
  /** After the tick, or after Open: the icons stay hidden until the pointer or focus leaves. */
  done: boolean
  copy: () => void
  /** Call after Open (or Show in Finder): hides the icons. */
  finish: () => void
  /** Root handlers: leaving brings the icons back next time. */
  onMouseLeave: () => void
  onBlur: (event: FocusEvent<HTMLElement>) => void
}

/**
 * The owner's copy feedback (2026-10-21): a copy turns the icon into a green
 * tick for 1.5 s, says "Copied" to screen readers, then the icons hide until the
 * pointer or focus leaves and comes back. A failed copy shows a cross instead.
 */
export function useCopyFeedback(text: string): CopyFeedback {
  const [state, setState] = useState<CopyState>('idle')
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => {
      setState('idle')
      setDone(true)
    }, COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [state])
  const copy = useCallback(() => {
    void copyText(text).then((ok) => {
      setDone(false)
      setState(ok ? 'copied' : 'failed')
      announce(ok ? 'Copied' : "Couldn't copy. Select the text and copy it instead.")
    })
  }, [text])
  const finish = useCallback(() => {
    setState('idle')
    setDone(true)
  }, [])
  const onMouseLeave = useCallback(() => setDone(false), [])
  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDone(false)
  }, [])
  return { state, done, copy, finish, onMouseLeave, onBlur }
}
