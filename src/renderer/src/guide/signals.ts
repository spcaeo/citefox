import type { GuideSignal } from '@shared/guide'

/**
 * Things the guide teaches that only the window sees (a brief copied, a
 * celebration previewed). A screen calls `signalGuide`; the guide host records it
 * for the open project. Nothing happens when no guide is listening.
 */
const listeners = new Set<(signal: GuideSignal) => void>()

export function signalGuide(signal: GuideSignal): void {
  for (const listener of listeners) listener(signal)
}

export function onGuideSignal(listener: (signal: GuideSignal) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
