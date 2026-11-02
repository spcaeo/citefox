import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useDrawerLevel } from '../../ui/Drawer/context'
import {
  aiBase,
  currentAiContext,
  registerAiPatch,
  removeAiPatch,
  subscribeAiContext,
  updateAiPatch
} from './store'
import type { AiContext, AiContextPatch } from './types'

/** The layer a component registers at: the screen is 0, a drawer is its depth + 1. */
export function useAiLayer(): number {
  const level = useDrawerLevel()
  return level === null ? 0 : level.depth + 1
}

/**
 * Tells Ask CiteFox what this screen or drawer shows, while it is mounted.
 * Call it once per screen with what only the screen knows (names, picked
 * rows, filters, the numbers it shows); the route part comes from the shell.
 * Pass a fresh object every render: it is compared by value.
 */
export function useAiContext(patch: AiContextPatch): void {
  const layer = useAiLayer()
  const token = useRef<number | null>(null)
  const key = JSON.stringify(patch)
  const latest = useRef(patch)
  // Kept current before the effects below read it (refs are not read while rendering).
  useLayoutEffect(() => {
    latest.current = patch
  })

  useLayoutEffect(() => {
    const mine = registerAiPatch(layer, latest.current)
    token.current = mine
    return () => {
      removeAiPatch(mine)
      token.current = null
    }
  }, [layer])

  useLayoutEffect(() => {
    if (token.current !== null) updateAiPatch(token.current, layer, latest.current)
  }, [key, layer])
}

/** The merged context, following every change. For the Ask drawer and the ✦ menus. */
export function useCurrentAiContext(): AiContext {
  return useSyncExternalStore(subscribeAiContext, currentAiContext, currentAiContext)
}

/** True inside the app shell with a project open: the ✦ menus show only then. */
export function useAiEnabled(): boolean {
  return useSyncExternalStore(subscribeAiContext, aiEnabled, aiEnabled)
}

function aiEnabled(): boolean {
  return aiBase()?.projectId != null
}
