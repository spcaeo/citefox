import { useEffect, useState } from 'react'
import type { SummarySource } from './components/PreviewCard'
import type { SummaryPage, SummaryPageLookup } from './utils/summaryPage'

/**
 * The page the schedule's AI summary preview reads, for the picked project.
 * Undefined while it loads; null for "All projects", no lookup, or no checked page.
 */
export function useSummaryPage(
  projectId: string | null,
  lookup: SummaryPageLookup | null
): SummarySource {
  const [found, setFound] = useState<{ projectId: string; page: SummaryPage | null } | null>(null)
  useEffect(() => {
    if (projectId === null || lookup === null) return
    let cancelled = false
    lookup(projectId).then(
      (page) => {
        if (!cancelled) setFound({ projectId, page })
      },
      () => {
        if (!cancelled) setFound({ projectId, page: null })
      }
    )
    return () => {
      cancelled = true
    }
  }, [projectId, lookup])
  if (projectId === null) return { projectId, page: null }
  if (lookup === null) return { projectId, page: null }
  return { projectId, page: found?.projectId === projectId ? found.page : undefined }
}
