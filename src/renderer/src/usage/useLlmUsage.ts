import { useEffect, useMemo, useState } from 'react'
import type { LlmUsage } from '@shared/ipc'
import { assistErrorText } from '../assist/model'
import { currentClientMode } from '../onboarding/flags'
import { createUsageClient, type UsageClient } from './client'

export interface LlmUsageState {
  usage: LlmUsage | null
  error: string | null
  loading: boolean
}

interface Loaded {
  key: string
  usage: LlmUsage | null
  error: string | null
}

/** Reads `llm:usage` for one project, or for everything when `projectId` is omitted. */
export function useLlmUsage(options: {
  client?: UsageClient
  projectId?: string
  /** Change it to read again, for example after the screen's Refresh. */
  refreshKey?: number | string
}): LlmUsageState {
  const { projectId, refreshKey } = options
  const client = useMemo(
    () => options.client ?? createUsageClient(currentClientMode()),
    [options.client]
  )
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const key = `${projectId ?? ''}\u0000${refreshKey ?? ''}`

  useEffect(() => {
    let cancelled = false
    client.usage(projectId === undefined ? {} : { projectId }).then(
      (usage) => {
        if (!cancelled) setLoaded({ key, usage, error: null })
      },
      (cause: unknown) => {
        if (!cancelled) setLoaded({ key, usage: null, error: assistErrorText(cause) })
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, key])

  const current = loaded?.key === key ? loaded : null
  return {
    usage: current?.usage ?? loaded?.usage ?? null,
    error: current?.error ?? null,
    loading: current === null
  }
}
