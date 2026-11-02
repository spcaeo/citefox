import { useSyncExternalStore } from 'react'
import type { AssistStepView } from './useAssistProgress'

/** "8 s", "1 min 5 s". Under half a second reads "0 s". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/** The sentence a screen reader hears when a step starts or ends. */
export function announcement(steps: readonly AssistStepView[], running: boolean): string {
  const current = [...steps].reverse().find((step) => step.state === 'running')
  if (current) return `${current.label}…`
  const last = steps.at(-1)
  if (!last) return running ? 'CiteFox AI is starting…' : ''
  if (last.state === 'failed') {
    return `${last.label}: failed${last.detail ? `. ${last.detail}` : ''}`
  }
  if (last.state === 'skipped') return `${last.label}: skipped`
  return running ? `${last.label}: done` : `Done. ${last.label}`
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeMotion(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(REDUCE_QUERY)
  query.addEventListener?.('change', listener)
  return () => query.removeEventListener?.('change', listener)
}

function readMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCE_QUERY).matches
}

/** True when the system asks for less motion: no pulse, no shimmer, no slide-in. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, readMotion, () => false)
}
