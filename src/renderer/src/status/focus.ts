import { navigateHash, sectionHash } from '../shell/routes'

/**
 * Where the Status screen should land when another control opens it: a
 * section card (by its heading id, such as `st-serp`) or the open-issues
 * list. The status popover uses this so a chip or "N issues" opens exactly
 * what it names, without a new route.
 */
export type StatusFocus =
  'issues' | 'st-serp' | 'st-claude' | 'st-jina' | 'st-yt' | 'st-email' | 'st-setup' | 'st-notices'

const EVENT = 'citefox:status-focus'
let pending: StatusFocus | null = null

/** Opens Status and asks it to focus `focus` once its data is on screen. */
export function openStatusAt(focus: StatusFocus): void {
  pending = focus
  navigateHash(sectionHash('status'))
  window.dispatchEvent(new Event(EVENT))
}

/** The waiting request, cleared. Null when there is none. */
export function takeStatusFocus(): StatusFocus | null {
  const value = pending
  pending = null
  return value
}

/** Calls `listener` when a request arrives while Status is already open. */
export function onStatusFocus(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

export type StatusTab = 'connections' | 'checks' | 'usage' | 'email'

/** The tab that holds a section the status popover asks for. Null: above the tabs. */
export function statusTabFor(focus: StatusFocus): StatusTab | null {
  if (focus === 'st-email') return 'email'
  if (focus === 'st-setup') return 'checks'
  if (focus === 'issues' || focus === 'st-notices') return null
  return 'connections'
}
