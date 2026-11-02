/** The standard data grid: saved views and Export CSV (FR-21.1, FR-21.2, FR-21.8). */

import type { gridChannels, IpcHandlersFor } from '@shared/ipc'
import { currentExportSaveDialog } from '../export/ipc'
import { exportGridCsv } from '../engine/grid/csv'
import {
  parseGridCsv,
  parseListViews,
  parseSaveView,
  parseScreenView,
  parseSetScreenView,
  parseSetSummaryBoard,
  parseSummaryBoard,
  parseViewId
} from '../engine/grid/parse'
import {
  deleteGridView,
  getProjectSummaryBoard,
  getRememberedScreenView,
  listGridViews,
  saveGridView,
  setProjectSummaryBoard,
  setRememberedScreenView
} from '../engine/grid/views'
import { guard, type EngineContext } from './context'

export function gridHandlers(ctx: EngineContext): IpcHandlersFor<typeof gridChannels> {
  return {
    'grid:listViews': (request) =>
      guard('grid:listViews', ctx, () => listGridViews(ctx, parseListViews(request))),
    'grid:saveView': (request) =>
      guard('grid:saveView', ctx, () => saveGridView(ctx, parseSaveView(request))),
    'grid:deleteView': (request) =>
      guard('grid:deleteView', ctx, () => deleteGridView(ctx, parseViewId(request))),
    'grid:exportCsv': (request) =>
      guard('grid:exportCsv', ctx, () =>
        exportGridCsv(parseGridCsv(request), {
          dialog: currentExportSaveDialog(),
          secrets: ctx.knownSecrets()
        })
      ),
    'grid:getScreenView': (request) =>
      guard('grid:getScreenView', ctx, () =>
        getRememberedScreenView(ctx, parseScreenView(request))
      ),
    'grid:setScreenView': (request) =>
      guard('grid:setScreenView', ctx, () =>
        setRememberedScreenView(ctx, parseSetScreenView(request))
      ),
    'grid:getSummaryBoard': (request) =>
      guard('grid:getSummaryBoard', ctx, () =>
        getProjectSummaryBoard(ctx, parseSummaryBoard(request))
      ),
    'grid:setSummaryBoard': (request) =>
      guard('grid:setSummaryBoard', ctx, () =>
        setProjectSummaryBoard(ctx, parseSetSummaryBoard(request))
      )
  }
}
