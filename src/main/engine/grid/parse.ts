import { GRID_ID_PATTERN, SAVED_VIEW_NAME_MAX } from '@shared/domain'
import type {
  GridCsvRequest,
  GridViewIdRequest,
  ListGridViewsRequest,
  SaveGridViewRequest,
  ScreenViewRequest,
  SetScreenViewRequest,
  SetSummaryBoardRequest,
  SummaryBoardRequest
} from '@shared/ipc'
import { normalizeBoard } from '@shared/summary-board'
import { IpcRequestError } from '../../ipc-request'
import { normalizeGridViewState } from '../../storage/grid-view-state'
import { SCREEN_KEY_PATTERN, SCREEN_VIEW_PATTERN } from '../../storage/screen-views'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const MAX_CSV_ROWS = 100_000
const MAX_CSV_COLUMNS = 64
const MAX_CELL_LENGTH = 10_000
const FILE_NAME = /^[^\\/:*?"<>|\0]{1,120}\.csv$/

export function parseListViews(value: unknown): ListGridViewsRequest {
  const channel = 'grid:listViews'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'grid'])
  return { projectId: readId(record.projectId, channel), grid: readGrid(record.grid, channel) }
}

export function parseSaveView(value: unknown): SaveGridViewRequest {
  const channel = 'grid:saveView'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'grid', 'id', 'name', 'state'])
  const state = normalizeGridViewState(record.state)
  if (state === null) throw new IpcRequestError(channel, 'That view could not be saved')
  return {
    projectId: readId(record.projectId, channel),
    grid: readGrid(record.grid, channel),
    id: record.id === null ? null : readId(record.id, channel),
    name: readName(record.name, channel),
    state
  }
}

export function parseViewId(value: unknown): GridViewIdRequest {
  const channel = 'grid:deleteView'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'viewId'])
  return { projectId: readId(record.projectId, channel), viewId: readId(record.viewId, channel) }
}

export function parseScreenView(value: unknown): ScreenViewRequest {
  const channel = 'grid:getScreenView'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'screen'])
  return {
    projectId: readId(record.projectId, channel),
    screen: readPattern(record.screen, SCREEN_KEY_PATTERN, channel)
  }
}

export function parseSetScreenView(value: unknown): SetScreenViewRequest {
  const channel = 'grid:setScreenView'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'screen', 'view'])
  return {
    projectId: readId(record.projectId, channel),
    screen: readPattern(record.screen, SCREEN_KEY_PATTERN, channel),
    view: readPattern(record.view, SCREEN_VIEW_PATTERN, channel)
  }
}

export function parseSummaryBoard(value: unknown): SummaryBoardRequest {
  const channel = 'grid:getSummaryBoard'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

export function parseSetSummaryBoard(value: unknown): SetSummaryBoardRequest {
  const channel = 'grid:setSummaryBoard'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'board'])
  const board = normalizeBoard(record.board)
  if (board === null) throw new IpcRequestError(channel, 'That Summary layout could not be saved')
  return { projectId: readId(record.projectId, channel), board }
}

function readPattern(value: unknown, pattern: RegExp, channel: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new IpcRequestError(channel)
  return value
}

export function parseGridCsv(value: unknown): GridCsvRequest {
  const channel = 'grid:exportCsv'
  const record = plain(value, channel)
  requireKeys(record, channel, ['fileName', 'header', 'rows'])
  const fileName = record.fileName
  if (typeof fileName !== 'string' || !FILE_NAME.test(fileName)) {
    throw new IpcRequestError(channel)
  }
  const header = record.header
  if (!Array.isArray(header) || header.length === 0 || header.length > MAX_CSV_COLUMNS) {
    throw new IpcRequestError(channel)
  }
  const headerCells = header.map((cell) => {
    if (typeof cell !== 'string' || cell.length === 0 || cell.length > 200) {
      throw new IpcRequestError(channel)
    }
    return cell
  })
  const rows = record.rows
  if (!Array.isArray(rows) || rows.length > MAX_CSV_ROWS) throw new IpcRequestError(channel)
  const cleanRows = rows.map((row) => {
    if (!Array.isArray(row) || row.length !== headerCells.length) {
      throw new IpcRequestError(channel)
    }
    return row.map((cell) => {
      if (cell === null) return null
      if (typeof cell === 'number' && Number.isFinite(cell)) return cell
      if (typeof cell === 'string' && cell.length <= MAX_CELL_LENGTH) return cell
      throw new IpcRequestError(channel)
    })
  })
  return { fileName, header: headerCells, rows: cleanRows }
}

function readGrid(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !GRID_ID_PATTERN.test(value)) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readName(value: unknown, channel: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const name = value.trim()
  if (name.length === 0 || name.length > SAVED_VIEW_NAME_MAX) {
    throw new IpcRequestError(channel, `Name the view in 1 to ${SAVED_VIEW_NAME_MAX} characters`)
  }
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code <= 31 || code === 127) throw new IpcRequestError(channel)
  }
  return name
}

export function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

export function plain(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

export function requireKeys(
  record: Record<string, unknown>,
  channel: string,
  allowed: readonly string[]
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new IpcRequestError(channel)
  }
}
