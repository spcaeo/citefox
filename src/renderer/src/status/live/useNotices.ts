import { useCallback, useEffect, useState } from 'react'
import type { Notice } from '@shared/domain'
import { errorText } from '../../components/errorText'
import type { LiveSource } from './source'

export interface NoticesState {
  /** Open notices, newest first. Empty until the first read. */
  notices: readonly Notice[]
  /** Why the list could not be read. Null when it was. */
  error: string | null
  /** What CiteFox did for the last answer, in plain words. Null before one. */
  message: string | null
  /** Resolves one notice with the chosen action. Returns what CiteFox did, in plain words. */
  resolve: (noticeId: string, actionId: string) => Promise<string>
}

/**
 * Open "ask me" notices (FR-11.4, FR-11.7), kept current from
 * `notices:changed`. With no source (no bridge) the list stays empty.
 */
export function useNotices(source: LiveSource | null): NoticesState {
  const [notices, setNotices] = useState<readonly Notice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!source) return
    try {
      const list = await source['notices:list']()
      setNotices(list.notices)
      setError(null)
    } catch (cause) {
      setError(errorText(cause, 'Could not read the notices.'))
    }
  }, [source])

  useEffect(() => {
    if (!source) return
    let live = true
    void Promise.resolve().then(() => (live ? load() : undefined))
    const off = source['notices:changed']((list) => {
      if (live) setNotices(list.notices)
    })
    return () => {
      live = false
      off()
    }
  }, [source, load])

  const resolve = useCallback(
    async (noticeId: string, actionId: string): Promise<string> => {
      if (!source) return ''
      const result = await source['notices:resolve']({ noticeId, actionId })
      setNotices((current) => current.filter((notice) => notice.id !== noticeId))
      setMessage(result.message)
      await load()
      return result.message
    },
    [source, load]
  )

  return { notices, error, message, resolve }
}
