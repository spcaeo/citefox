import { useEffect, useState } from 'react'
import type { ClaudePauseInfo } from '@shared/ipc'
import { BRIDGE_PAUSE_SOURCE, type ClaudePauseSource } from './source'

/** setTimeout's longest wait; a longer pause is read again then. */
const MAX_TIMER_MS = 2 ** 31 - 1
/** Read a little after the pause ends, so main sees it ended too. */
const AFTER_END_MS = 500

/**
 * The Claude Code pause after a usage limit, while `active` (an error is on screen),
 * or null. Read when the error shows, again whenever main says the pause started or
 * was lifted, and again when it runs out, so Try again comes back by itself.
 */
export function useClaudePause(
  active: boolean,
  projectId: string | null,
  source: ClaudePauseSource = BRIDGE_PAUSE_SOURCE
): ClaudePauseInfo | null {
  const [pause, setPause] = useState<ClaudePauseInfo | null>(null)

  useEffect(() => {
    if (!active) return undefined
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const read = (): void => {
      source.get(projectId).then(
        (next) => {
          if (!live) return
          setPause(next)
          if (timer !== null) clearTimeout(timer)
          timer = null
          if (next === null) return
          const left = Date.parse(next.until) - Date.now()
          const wait = Number.isFinite(left) ? Math.max(left, 0) + AFTER_END_MS : AFTER_END_MS
          timer = setTimeout(read, Math.min(wait, MAX_TIMER_MS))
        },
        () => {
          if (live) setPause(null)
        }
      )
    }
    read()
    const stop = source.onChange(read)
    return () => {
      live = false
      stop()
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, projectId, source])

  return active ? pause : null
}
