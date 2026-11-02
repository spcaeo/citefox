import { useEffect } from 'react'
import type { DrawerId, DrawerParamPatch } from '../shell/drawerUrl'
import { drawerHref } from '../shell/drawers'
import { replaceHash } from '../shell/routes'
import { patchHashQuery } from '../utils/hashQuery'

/** A side panel's old screen URL value and the drawer it opens now. */
export interface LegacyPanel {
  /** The screen key that held the panel (`panel`, `filter`). */
  key: string
  id: DrawerId
  values?: DrawerParamPatch
}

/**
 * Old links to a page setup side panel (`?panel=settings`, `?filter=edit:<id>`)
 * open its drawer: the URL is rewritten in place, without the old value, so
 * Back still leaves the screen the way it came.
 */
export function useLegacyPanel(legacy: LegacyPanel | null): void {
  const signature = legacy ? JSON.stringify(legacy) : ''
  useEffect(() => {
    if (!signature) return
    const { key, id, values } = JSON.parse(signature) as LegacyPanel
    const hash = window.location.hash
    replaceHash(drawerHref(id, values ?? {}, patchHashQuery(hash, { [key]: null })))
  }, [signature])
}
