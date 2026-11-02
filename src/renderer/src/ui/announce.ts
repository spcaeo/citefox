/**
 * One polite live region for short confirmations ("Copied"), shared by every
 * UrlText so a list of 2,000 rows does not carry 2,000 empty status regions.
 * The text is cleared after a moment, so saying the same thing twice is heard twice.
 */

const CLEAR_MS = 3000

let region: HTMLElement | null = null
let clearTimer: ReturnType<typeof setTimeout> | null = null

function liveRegion(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null
  if (region !== null && region.isConnected) return region
  region = document.createElement('div')
  region.className = 'sr-only'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  region.dataset.announcer = ''
  document.body.append(region)
  return region
}

export function announce(message: string): void {
  const target = liveRegion()
  if (target === null) return
  // A fresh text node each time, so a repeat of the same words is read again.
  target.replaceChildren(document.createTextNode(message))
  if (clearTimer !== null) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    target.textContent = ''
    clearTimer = null
  }, CLEAR_MS)
}

/** Tests: what the region says now. */
export function announcedText(): string {
  return region?.textContent ?? ''
}

/** Tests: remove the region. */
export function resetAnnouncerForTests(): void {
  if (clearTimer !== null) clearTimeout(clearTimer)
  clearTimer = null
  region?.remove()
  region = null
}
