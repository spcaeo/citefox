import type { SavedGridView } from '@shared/domain'
import type {
  DeletedGridView,
  GridViewIdRequest,
  GridViewList,
  ListGridViewsRequest,
  SaveGridViewRequest,
  ScreenViewRequest,
  ScreenViewResult,
  SetScreenViewRequest,
  SetSummaryBoardRequest,
  SummaryBoardRequest,
  SummaryBoardResult
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { deleteSavedView, getSavedView, listSavedViews, saveView } from '../../storage/saved-views'
import { getScreenView, setScreenView } from '../../storage/screen-views'
import { getSummaryBoard, setSummaryBoard } from '../../storage/summary-board'
import type { EngineHost } from '../host'
import { withProject } from '../project-db'

/** FR-21.2. Saved views live in the project file, per grid id. */
export function listGridViews(
  host: EngineHost,
  request: ListGridViewsRequest
): Promise<GridViewList> {
  return withProject(host, request.projectId, 'grid:listViews', (opened) => ({
    views: listSavedViews(opened.db, request.grid)
  }))
}

export function saveGridView(
  host: EngineHost,
  request: SaveGridViewRequest
): Promise<SavedGridView> {
  const channel = 'grid:saveView'
  return withProject(host, request.projectId, channel, (opened) => {
    if (request.id !== null) {
      const existing = getSavedView(opened.db, request.id)
      if (existing === null || existing.grid !== request.grid) {
        throw new IpcRequestError(channel, 'That view was not found')
      }
    }
    const taken = listSavedViews(opened.db, request.grid).find(
      (view) => view.name.toLowerCase() === request.name.toLowerCase() && view.id !== request.id
    )
    if (taken !== undefined) {
      throw new IpcRequestError(channel, `A view named “${taken.name}” already exists`)
    }
    return saveView(opened.db, {
      id: request.id ?? `view-${host.createId()}`,
      grid: request.grid,
      name: request.name,
      state: request.state,
      at: host.now().toISOString()
    })
  })
}

export function deleteGridView(
  host: EngineHost,
  request: GridViewIdRequest
): Promise<DeletedGridView> {
  const channel = 'grid:deleteView'
  return withProject(host, request.projectId, channel, (opened) => {
    if (!deleteSavedView(opened.db, request.viewId)) {
      throw new IpcRequestError(channel, 'That view was not found')
    }
    return { id: request.viewId }
  })
}

/** The view a screen was last shown in, in this project. */
export function getRememberedScreenView(
  host: EngineHost,
  request: ScreenViewRequest
): Promise<ScreenViewResult> {
  return withProject(host, request.projectId, 'grid:getScreenView', (opened) => ({
    view: getScreenView(opened.db, request.screen)
  }))
}

export function setRememberedScreenView(
  host: EngineHost,
  request: SetScreenViewRequest
): Promise<ScreenViewResult> {
  return withProject(host, request.projectId, 'grid:setScreenView', (opened) => ({
    view: setScreenView(opened.db, request.screen, request.view, host.now().toISOString())
  }))
}

/** The project's Summary widgets. Null: never arranged (the app shows its default). */
export function getProjectSummaryBoard(
  host: EngineHost,
  request: SummaryBoardRequest
): Promise<SummaryBoardResult> {
  return withProject(host, request.projectId, 'grid:getSummaryBoard', (opened) => ({
    board: getSummaryBoard(opened.db)
  }))
}

export function setProjectSummaryBoard(
  host: EngineHost,
  request: SetSummaryBoardRequest
): Promise<SummaryBoardResult> {
  return withProject(host, request.projectId, 'grid:setSummaryBoard', (opened) => ({
    board: setSummaryBoard(opened.db, request.board, host.now().toISOString())
  }))
}
