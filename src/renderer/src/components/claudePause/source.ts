import type { ClaudePauseInfo } from '@shared/ipc'

/** Where the window reads the Claude Code pause (`claudeCode:getPause`, `claudeCode:pauseChanged`). */
export interface ClaudePauseSource {
  get: (projectId: string | null) => Promise<ClaudePauseInfo | null>
  /** Called when a pause starts or is lifted early. Returns the unsubscribe. */
  onChange: (listener: () => void) => () => void
}

type PauseBridge = Partial<
  Pick<Window['citefox'], 'claudeCode:getPause' | 'claudeCode:pauseChanged'>
>

function bridge(): PauseBridge | undefined {
  return (typeof window === 'undefined' ? undefined : window.citefox) as PauseBridge | undefined
}

/**
 * The preload bridge, looked up on each call. Without one (the mock UI, most tests)
 * nothing is ever paused, so every Try again stays as it was.
 */
export const BRIDGE_PAUSE_SOURCE: ClaudePauseSource = {
  get: async (projectId) => {
    const get = bridge()?.['claudeCode:getPause']
    return typeof get === 'function' ? get({ projectId }) : null
  },
  onChange: (listener) => {
    const subscribe = bridge()?.['claudeCode:pauseChanged']
    return typeof subscribe === 'function' ? subscribe(() => listener()) : () => undefined
  }
}
