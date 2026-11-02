import { useEffect, useState } from 'react'
import type { ConnectionActivity, ConnectionActivityLog } from '@shared/domain'
import type { AdminClient } from '../../admin/client'
import { plainError } from '../utils/model'

/**
 * FR-11.10. Reads the last 24 hours on load and again whenever `refresh` changes
 * (the overview reloads after every key action). With the activity log the
 * counts come from the same rows the drill drawers list, so they always match.
 */
export function useActivity(
  admin: AdminClient | undefined,
  refresh: unknown
): {
  activity: ConnectionActivity | null
  log: ConnectionActivityLog | null
  error: string | null
} {
  const [activity, setActivity] = useState<ConnectionActivity | null>(null)
  const [log, setLog] = useState<ConnectionActivityLog | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!admin) return
    let cancelled = false
    const read: Promise<ConnectionActivity | ConnectionActivityLog> = admin.connectionActivityLog
      ? admin.connectionActivityLog()
      : admin.connectionActivity()
    read.then(
      (next) => {
        if (cancelled) return
        setActivity(next)
        setLog('entries' in next ? next : null)
        setError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setError(plainError(cause))
      }
    )
    return () => {
      cancelled = true
    }
  }, [admin, refresh])
  return { activity, log, error }
}
