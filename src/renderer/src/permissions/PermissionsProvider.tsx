import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type {
  ClaudeCheckupProgress,
  ClaudeStatus,
  PermissionId,
  PermissionRequestResult,
  PermissionsSnapshot
} from '@shared/ipc'
import { errorText } from '../components/errorText'
import {
  PermissionsContext,
  type CheckupSteps,
  type PermissionsContextValue
} from '../ui/permissionsContext'
import type { PermissionsClient } from './client'

/** A focus after this long re-reads the snapshot (a key added in another window, a new checkup). */
export const FOCUS_REFRESH_MS = 30_000

/**
 * Holds "What CiteFox needs" and the Claude status for the whole window, so the
 * Profile step, every AI menu and suggestion card, the status capsule and the
 * checklist agree. Reads are cheap and never open a system prompt; a Claude
 * Code checkup runs only from `checkClaude`/`ensureClaude` or a click.
 */
export function PermissionsProvider({
  client,
  children,
  now = Date.now
}: {
  client: PermissionsClient
  children: ReactNode
  /** Tests freeze this. */
  now?: () => number
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<PermissionsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<ClaudeCheckupProgress | null>(null)
  const [steps, setSteps] = useState<CheckupSteps>({})
  const [busy, setBusy] = useState<PermissionId | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const latest = useRef<PermissionsSnapshot | null>(null)
  const lastRead = useRef(0)
  const ownCheck = useRef<Promise<PermissionRequestResult | null> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const accept = useCallback(
    (next: PermissionsSnapshot) => {
      latest.current = next
      lastRead.current = now()
      if (!mounted.current) return
      setSnapshot(next)
      setError(null)
    },
    [now]
  )

  const refresh = useCallback(async (): Promise<PermissionsSnapshot | null> => {
    try {
      const next = await client.list()
      accept(next)
      return next
    } catch (cause: unknown) {
      if (mounted.current) setError(errorText(cause, 'CiteFox could not read what it needs.'))
      return null
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [accept, client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    function onFocus(): void {
      if (now() - lastRead.current >= FOCUS_REFRESH_MS) void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [now, refresh])

  useEffect(
    () =>
      client.onCheckupProgress((payload) => {
        if (ownCheck.current === null || !mounted.current) return
        setProgress(payload)
        setSteps((current) => ({
          ...current,
          [payload.phase]: { state: payload.state, detail: payload.detail }
        }))
      }),
    [client]
  )

  const request = useCallback(
    async (id: PermissionId): Promise<PermissionRequestResult | null> => {
      if (id === 'claude' && ownCheck.current !== null) return ownCheck.current
      const run = (async (): Promise<PermissionRequestResult | null> => {
        setBusy(id)
        setMessage(null)
        if (id === 'claude') {
          setChecking(true)
          setProgress(null)
          setSteps({})
        }
        try {
          const result = await client.request({ id })
          accept(result.snapshot)
          if (mounted.current) setMessage(result.message)
          return result
        } catch (cause: unknown) {
          if (mounted.current) setMessage(errorText(cause, 'That did not work. Try again.'))
          void refresh()
          return null
        } finally {
          if (mounted.current) {
            setBusy(null)
            if (id === 'claude') setChecking(false)
          }
        }
      })()
      if (id === 'claude') {
        ownCheck.current = run
        void run.finally(() => {
          ownCheck.current = null
        })
      }
      return run
    },
    [accept, client, refresh]
  )

  const checkClaude = useCallback(async (): Promise<ClaudeStatus | null> => {
    const current = latest.current ?? (await refresh())
    if (current?.claude.connection === 'anthropic-api') return (await refresh())?.claude ?? null
    const result = await request('claude')
    return result?.snapshot.claude ?? latest.current?.claude ?? null
  }, [refresh, request])

  const ensureClaude = useCallback(async (): Promise<ClaudeStatus | null> => {
    const current = latest.current ?? (await refresh())
    if (current?.claude.state === 'ready' && current.claude.fresh) return current.claude
    return checkClaude()
  }, [checkClaude, refresh])

  const value = useMemo<PermissionsContextValue>(
    () => ({
      snapshot,
      claude: snapshot?.claude ?? null,
      loading,
      error,
      checking,
      progress,
      steps,
      busy,
      message,
      refresh,
      checkClaude,
      ensureClaude,
      request
    }),
    [
      snapshot,
      loading,
      error,
      checking,
      progress,
      steps,
      busy,
      message,
      refresh,
      checkClaude,
      ensureClaude,
      request
    ]
  )

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}
