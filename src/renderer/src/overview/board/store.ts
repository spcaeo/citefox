import type { SummaryBoard } from '@shared/summary-board'
import { addWidget, canAdd, defaultBoard, hasSameWidget, type WidgetSpec } from './model'

/**
 * Where each project's Summary board is kept: the project file (`grid:getSummaryBoard` /
 * `grid:setSummaryBoard`), with the latest board per project held in memory so Summary
 * opens at once and a "Pin to Summary" on another screen shows when Summary opens.
 */
export interface BoardStore {
  get: (projectId: string) => Promise<SummaryBoard | null>
  set: (projectId: string, board: SummaryBoard) => Promise<void>
}

let ipc: { api: Window['citefox']; store: BoardStore } | null = null

/** The store over IPC, or null outside the app (tests, a browser preview). */
export function ipcBoardStore(): BoardStore | null {
  if (typeof window === 'undefined' || !window.citefox) return null
  const api = window.citefox
  if (ipc?.api === api) return ipc.store
  const store: BoardStore = {
    get: async (projectId) => (await api['grid:getSummaryBoard']({ projectId })).board,
    set: async (projectId, board) => {
      await api['grid:setSummaryBoard']({ projectId, board })
    }
  }
  ipc = { api, store }
  return store
}

const boards = new Map<string, SummaryBoard>()
const loading = new Map<string, Promise<SummaryBoard>>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeBoards(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The board in memory for a project, or undefined before it loaded. */
export function boardInMemory(projectId: string): SummaryBoard | undefined {
  return boards.get(projectId)
}

/** Forgets every board held in memory (tests). */
export function resetBoardMemory(): void {
  boards.clear()
  loading.clear()
  emit()
}

/** The project's board: from memory, else the store, else today's Summary as widgets. */
export function loadBoard(projectId: string, store: BoardStore | null): Promise<SummaryBoard> {
  const known = boards.get(projectId)
  if (known !== undefined) return Promise.resolve(known)
  const pending = loading.get(projectId)
  if (pending !== undefined) return pending
  const read = (store === null ? Promise.resolve(null) : store.get(projectId))
    .catch(() => null)
    .then((saved) => {
      loading.delete(projectId)
      // A board saved meanwhile (a quick pin) wins over the stored one.
      const now = boards.get(projectId) ?? saved ?? defaultBoard()
      boards.set(projectId, now)
      emit()
      return now
    })
  loading.set(projectId, read)
  return read
}

/** Shows `board` at once and saves it. A failed save keeps it for this session. */
export function saveBoard(
  projectId: string,
  board: SummaryBoard,
  store: BoardStore | null
): Promise<void> {
  boards.set(projectId, board)
  emit()
  return store === null ? Promise.resolve() : store.set(projectId, board).catch(() => undefined)
}

export type PinResult = 'added' | 'exists' | 'full'

/** Pin to Summary: adds a widget for this thing to the project's board. */
export async function pinWidget(
  projectId: string,
  spec: WidgetSpec,
  store: BoardStore | null
): Promise<PinResult> {
  const board = await loadBoard(projectId, store)
  if (hasSameWidget(board, spec)) return 'exists'
  if (!canAdd(board)) return 'full'
  await saveBoard(projectId, addWidget(board, spec), store)
  return 'added'
}
