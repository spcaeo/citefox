/**
 * "Start first check" from a page's review screen (owner feedback 5): the tab
 * asks for the check, then opens the check screen, which starts it once it
 * knows no check is running for the page. One request per click; consumed once.
 */
const pending = new Set<string>()

export function requestCheckStart(pageId: string): void {
  pending.add(pageId)
}

/** True once for a page whose check was requested. */
export function takeCheckStart(pageId: string): boolean {
  return pending.delete(pageId)
}
