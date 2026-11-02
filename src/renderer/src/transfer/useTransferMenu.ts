import { useEffect, useRef } from 'react'
import { runMenuCommand } from './actions'
import { transferClient, type TransferClient } from './client'

/**
 * The File menu's Export / Import items (main pushes `transfer:menu`). Export
 * Project acts on the open project; the rest need none.
 */
export function useTransferMenu(activeProjectId: string | null, client?: TransferClient): void {
  const active = useRef(activeProjectId)
  useEffect(() => {
    active.current = activeProjectId
  }, [activeProjectId])
  useEffect(() => {
    const source = client ?? transferClient()
    return source.onMenu((event) => runMenuCommand(event.command, active.current, source))
  }, [client])
}
