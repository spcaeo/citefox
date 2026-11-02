import { useEffect, useState } from 'react'
import { navigateHash, OVERLAY_PARAM, replaceHash } from '../shell/routes'

/**
 * The build menu's confirm dialogs live on the URL as `?dialog=<id>` on any
 * route (owner rule: every state has a URL), so `#/settings?dialog=reset`
 * opens Settings with the reset dialog over it. Back closes the dialog.
 */
export const BUILD_DIALOGS = ['reset', 'fresh-test'] as const
export type BuildDialog = (typeof BUILD_DIALOGS)[number]

/** The query key; `parseHash` leaves it out of a route's own params. */
const DIALOG_PARAM = OVERLAY_PARAM

function isBuildDialog(value: string | null): value is BuildDialog {
  return BUILD_DIALOGS.some((item) => item === value)
}

function split(hash: string): { path: string; params: URLSearchParams } {
  const plain = hash.startsWith('#') ? hash.slice(1) : hash
  const at = plain.indexOf('?')
  return at < 0
    ? { path: plain, params: new URLSearchParams() }
    : { path: plain.slice(0, at), params: new URLSearchParams(plain.slice(at + 1)) }
}

/** The open build dialog in `hash`, or null. */
export function dialogFromHash(hash: string): BuildDialog | null {
  const value = split(hash).params.get(DIALOG_PARAM)
  return isBuildDialog(value) ? value : null
}

/** `hash` with `dialog` set, or removed when null; the route and its other values stay. */
export function withDialog(hash: string, dialog: BuildDialog | null): string {
  const { path, params } = split(hash)
  if (dialog) params.set(DIALOG_PARAM, dialog)
  else params.delete(DIALOG_PARAM)
  const query = params.toString()
  return `#${path}${query ? `?${query}` : ''}`
}

/** Opens `dialog` over the current route (a new history entry, so Back closes it). */
export function openBuildDialog(dialog: BuildDialog): void {
  navigateHash(withDialog(window.location.hash, dialog))
}

/** Closes the build dialog in place. */
export function closeBuildDialog(): void {
  replaceHash(withDialog(window.location.hash, null))
}

/** The build dialog the URL asks for, following hash changes. */
export function useBuildDialog(): BuildDialog | null {
  const [dialog, setDialog] = useState<BuildDialog | null>(() =>
    typeof window === 'undefined' ? null : dialogFromHash(window.location.hash)
  )
  useEffect(() => {
    function onHash(): void {
      setDialog(dialogFromHash(window.location.hash))
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return dialog
}
