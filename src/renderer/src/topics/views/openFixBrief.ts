import { openPageFix } from '../../fixes/todo/openPageFix'
import { showUndo } from '../../ui'
import { pageFixIdsFor, type Search } from './model'

/**
 * Get fix brief for these searches: the page fix drawer over the screen it was pressed
 * on, writing the brief at once (Fixes' own drawer, so every screen hands out the same
 * brief). Searches spread over several fixes open the biggest; the drawer steps on.
 */
export function openFixBrief(picked: readonly Search[]): void {
  const ids = pageFixIdsFor(picked)
  if (ids.length === 0) {
    showUndo({ message: 'None of these searches needs a page fix right now.' })
    return
  }
  openPageFix(ids, { start: true })
}
