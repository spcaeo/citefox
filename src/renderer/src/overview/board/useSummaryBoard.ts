import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { SummaryBoard } from '@shared/summary-board'
import {
  boardInMemory,
  ipcBoardStore,
  loadBoard,
  saveBoard,
  subscribeBoards,
  type BoardStore
} from './store'

export interface SummaryBoardState {
  /** Null while the saved board loads. */
  board: SummaryBoard | null
  /** Shows the board at once and saves it in the project. */
  save: (board: SummaryBoard) => void
}

/** The open project's Summary board. `store` undefined: the IPC store; null keeps nothing. */
export function useSummaryBoard(projectId: string, store?: BoardStore | null): SummaryBoardState {
  const resolved = useMemo(() => (store === undefined ? ipcBoardStore() : store), [store])
  const board = useSyncExternalStore(
    subscribeBoards,
    () => boardInMemory(projectId) ?? null,
    () => null
  )
  useEffect(() => {
    void loadBoard(projectId, resolved)
  }, [projectId, resolved])
  const save = useCallback(
    (next: SummaryBoard) => {
      void saveBoard(projectId, next, resolved)
    },
    [projectId, resolved]
  )
  return { board, save }
}
