import type { PageChange } from '@shared/ipc'
import { viewFixValues } from '../fixes/drawer/model'
import { notifyChanged } from '../shell/changes'
import { openDrawer } from '../shell/drawers'
import { showUndo, type ChartEvent } from '../ui'
import type { PageChangesSource } from './client'
import { changeDrawerValues, changeIdOfEvent, changePath, logFixValues } from './model'

/**
 * What every "Is this a fix?" offers, wherever it shows (the Pages banner, the
 * list drawer, the diff drawer, a chart's "?" marker): log it as a fix, see what
 * changed, or "Not a fix" with Undo.
 */
export interface PageChangeActions {
  logAsFix: (change: PageChange, text?: string) => void
  seeWhatChanged: (change: PageChange) => void
  notAFix: (change: PageChange) => Promise<void>
  /** Undo "Not a fix". */
  restore: (change: PageChange) => Promise<void>
}

export function pageChangeActions(source: PageChangesSource, projectId: string): PageChangeActions {
  const restore = async (change: PageChange): Promise<void> => {
    await source['pageChanges:restore']({ projectId, changeId: change.id })
    notifyChanged('pageChanges')
  }
  return {
    logAsFix: (change, text) => openDrawer('fix', logFixValues(change, text)),
    seeWhatChanged: (change) => openDrawer('page-change', changeDrawerValues(change)),
    notAFix: async (change) => {
      await source['pageChanges:dismiss']({ projectId, changeId: change.id })
      notifyChanged('pageChanges')
      showUndo({
        message: `Marked the change on ${change.label ?? changePath(change)} as not a fix.`,
        effect: 'It stays in the page’s History.',
        undo: () => restore(change),
        testId: 'page-change-undo'
      })
    },
    restore
  }
}

/** A chart marker was opened: a fix opens its drawer, a "?" opens what changed. */
export function openChartEvent(event: ChartEvent): void {
  if (event.fixId) {
    openDrawer('fix', viewFixValues(event.fixId))
    return
  }
  const changeId = changeIdOfEvent(event)
  if (changeId !== null) openDrawer('page-change', { 'pc.id': changeId })
}
