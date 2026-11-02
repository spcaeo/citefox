import { openDrawer } from '../../shell/drawers'

/** The fix whose brief starts as soon as its drawer opens (a Get fix brief press). */
let startOnOpen: string | null = null

/**
 * Opens the page fix drawer over the current screen (`drawer=page-fix`). With several
 * fixes the first opens and the drawer steps through the rest. `start` writes the
 * brief at once, as the Get fix brief button does in Fixes; it is never on the URL,
 * so a copied link or Back does not start another AI run.
 */
export function openPageFix(ids: readonly string[], options: { start?: boolean } = {}): void {
  const [first] = ids
  if (first === undefined) return
  startOnOpen = options.start ? first : null
  openDrawer('page-fix', {
    'pfx.id': first,
    'pfx.ids': ids.length > 1 ? ids.join(',') : null
  })
}

/** True once for the fix the last `openPageFix` asked to start. */
export function takeStartOnOpen(id: string): boolean {
  const start = startOnOpen === id
  if (start) startOnOpen = null
  return start
}
