import type { AllPageRow } from '@shared/ipc'
import { safeExternalUrl } from '../../drill'
import { pageHash } from '../../shell/routes'
import { patchHashQuery } from '../../utils/hashQuery'

/**
 * Where a page row opens. A tracked or paused page opens its Results; a page
 * still setting up opens its current setup step; a found page that is not
 * tracked (or was removed) has no checks, so it opens in the browser.
 */
export function pageHref(row: AllPageRow): { href: string; external: boolean } | null {
  if (row.status === 'tracked' || row.status === 'paused') {
    return { href: pageHash(row.id), external: false }
  }
  if (row.status === 'setting_up') return { href: setupHref(row), external: false }
  const url = safeExternalUrl(row.url)
  return url ? { href: url, external: true } : null
}

/**
 * A page still setting up opens its Prompts tab (owner feedback 5): the live
 * setup panel while CiteFox works, then the review. A page whose prompts are
 * saved opens Results, which shows its first-check summary.
 */
export function setupHref(row: Pick<AllPageRow, 'id' | 'setupStep'>): string {
  return row.setupStep === 'check' ? pageHash(row.id) : pageHash(row.id, 'prompts')
}

/**
 * The All pages URL for a picked view (`#/pages?preset=lost`), so the view can be
 * copied and opened again. Null when the window is not on plain `#/pages` (a
 * project route the shell is still switching) or the view has no link form.
 */
export function viewHash(
  current: string,
  viewId: string,
  linkable: readonly string[]
): string | null {
  const path = current.split('?')[0] ?? ''
  if (path !== '#/pages' && path !== '#/pages/') return null
  if (!linkable.includes(viewId)) return null
  // Other screen values (the open Needs attention list) stay; the grid's deep-link filters go.
  return patchHashQuery(current, {
    preset: viewId === 'all' ? null : viewId,
    folder: null,
    cluster: null,
    group: null,
    market: null
  }).replace(/^#\/pages\/(?=\?|$)/, '#/pages')
}
