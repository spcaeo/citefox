import type { HelpFillSource } from './types'

/**
 * The helper's channels on the preload bridge. Async so a missing bridge rejects
 * the call instead of throwing during render.
 */
export function createHelpFillSource(): HelpFillSource {
  return {
    'helpfill:estimate': async (request) => requireApi()['helpfill:estimate'](request),
    'helpfill:prompt': async (request) => requireApi()['helpfill:prompt'](request),
    'helpfill:read': async (request) => requireApi()['helpfill:read'](request),
    'helpfill:describe': async (request) => requireApi()['helpfill:describe'](request)
  }
}

/** Opens a link in the system browser: main's window-open handler calls `shell.openExternal`. */
export function openInBrowser(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
