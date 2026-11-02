/** ⌘J on a Mac, Ctrl J elsewhere: opens Ask CiteFox from any screen. */
const MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export const ASK_SHORTCUT = MAC
  ? ({ text: '⌘J', aria: 'Meta+J' } as const)
  : ({ text: 'Ctrl J', aria: 'Control+J' } as const)

/** True for the keystroke that opens Ask CiteFox (⌘J or Ctrl J, no other modifier). */
export function isAskShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== 'j' || event.altKey || event.shiftKey) return false
  return event.metaKey !== event.ctrlKey
}
