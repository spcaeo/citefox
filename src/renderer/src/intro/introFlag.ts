const KEY = 'citefox.introSeen'

/**
 * Whether this window has already shown the welcome tour. Kept in the window's own storage,
 * so Reset (which clears it) shows the tour again. A blocked or empty store reads as "not
 * seen" and never throws.
 */
export function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(KEY, new Date().toISOString())
  } catch {
    // Not saved: the tour may show once more. Harmless.
  }
}
