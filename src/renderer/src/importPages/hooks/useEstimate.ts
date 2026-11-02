import { useEffect, useState } from 'react'
import type { ImportEstimate, ImportEstimateRequest } from '@shared/ipc'
import { useDebouncedValue } from '../../shell/useDebouncedValue'
import type { StructureClient } from '../../structure/client'
import { ESTIMATE_DEBOUNCE_MS } from '../constants'
import { errorText } from '../../components/errorText'

interface Loaded {
  key: string
  estimate: ImportEstimate | null
  error: string | null
}

/** `import:estimate`, asked again once the inputs settle. Null request means nothing to estimate. */
export function useEstimate(
  client: StructureClient,
  request: ImportEstimateRequest | null
): { estimate: ImportEstimate | null; error: string | null; pending: boolean } {
  const key = request === null ? '' : JSON.stringify(request)
  const settledKey = useDebouncedValue(key, ESTIMATE_DEBOUNCE_MS)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (settledKey === '') return
    let cancelled = false
    const parsed = JSON.parse(settledKey) as ImportEstimateRequest
    client['import:estimate'](parsed).then(
      (estimate) => {
        if (!cancelled) setLoaded({ key: settledKey, estimate, error: null })
      },
      (cause: unknown) => {
        if (cancelled) return
        const text = errorText(cause, 'No estimate yet.')
        setLoaded({ key: settledKey, estimate: null, error: text })
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, settledKey])

  if (key === '') return { estimate: null, error: null, pending: false }
  const current = loaded !== null && loaded.key === key
  return {
    estimate: loaded?.estimate ?? null,
    error: current ? (loaded?.error ?? null) : null,
    pending: !current
  }
}
