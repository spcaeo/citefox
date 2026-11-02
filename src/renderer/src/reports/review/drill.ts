import { currentDrawers, openDrawer } from '../../shell/drawers'

/** The drawers a ready report opens (shell/drawerUrl `report-drill`, `report-detail`). */
export const DRILL_DRAWER = 'report-drill'
export const DETAIL_DRAWER = 'report-detail'

/**
 * Opens the drawer of what a number, bar or row counts. From inside the drill drawer a
 * row opens the detail drawer over it instead (two at most).
 */
export function openReportDrill(id: string): void {
  openDrawer(DRILL_DRAWER, { rd: id })
}

/** A question (`q:<id>`), a site (`site:<domain>`) or a page (`page:<url>`), one level down. */
export function openReportDetail(id: string): void {
  const stack = currentDrawers()
  const top = stack.at(-1)
  if (top?.id === DETAIL_DRAWER) {
    openDrawer(DETAIL_DRAWER, { rd2: id }, { replace: true })
    return
  }
  if (top?.id === DRILL_DRAWER) {
    openDrawer(DETAIL_DRAWER, { rd2: id })
    return
  }
  // Straight from the screen (a table row): the detail opens on its own.
  openDrawer(DETAIL_DRAWER, { rd2: id })
}

export function questionDetail(id: string): string {
  return `q:${id}`
}

export function pageDetail(url: string): string {
  return `page:${url}`
}

export function siteDetail(domain: string): string {
  return `site:${domain}`
}
