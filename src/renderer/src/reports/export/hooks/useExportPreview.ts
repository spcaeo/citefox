import { useEffect, useState } from 'react'
import type { ExportPreview } from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { blockedExportPreview, explainExportError, type ReportsClient } from '../../client'

/** Wait this long after the last change before asking main for a preview. */
export const PREVIEW_DEBOUNCE_MS = 200

/**
 * `exports:preview` for the current request, debounced. Null while a preview is on its way.
 * A null request (no project) never calls main.
 */
export function useExportPreview(
  client: ReportsClient,
  request: ExportRequest | null
): ExportPreview | null {
  const [preview, setPreview] = useState<{ for: ExportRequest; value: ExportPreview } | null>(null)

  useEffect(() => {
    if (!request) return
    let cancelled = false
    const timer = setTimeout(() => {
      client.previewExport(request).then(
        (value) => {
          if (!cancelled) setPreview({ for: request, value })
        },
        (error: unknown) => {
          if (cancelled) return
          const explained = explainExportError(error)
          setPreview({
            for: request,
            value: blockedExportPreview(explained.reason, explained.nextStep)
          })
        }
      )
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, request])

  return preview && preview.for === request ? preview.value : null
}
