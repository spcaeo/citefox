import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SavedPageFixBrief } from '@shared/ipc'
import type { ProjectFixesSource } from '../source'

export interface PageFixBriefsState {
  /** Saved briefs by page fix id. Empty until loaded (and when the read fails). */
  byFix: ReadonlyMap<string, SavedPageFixBrief>
  /** Puts a brief just saved in place, so its Status turns "Brief ready" at once. */
  put: (saved: SavedPageFixBrief) => void
}

/** `fixes:briefs`: the saved page fix briefs of the project (What to fix's Status). */
export function usePageFixBriefs(
  source: Pick<ProjectFixesSource, 'fixes:briefs'>,
  projectId: string
): PageFixBriefsState {
  const [list, setList] = useState<readonly SavedPageFixBrief[]>([])

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => source['fixes:briefs']({ projectId }))
      .then(
        (next) => {
          if (live) setList(next.briefs)
        },
        // Without the saved briefs every fix reads New; nothing else breaks.
        () => undefined
      )
    return () => {
      live = false
    }
  }, [source, projectId])

  const put = useCallback((saved: SavedPageFixBrief) => {
    setList((current) => [saved, ...current.filter((item) => item.fixId !== saved.fixId)])
  }, [])

  const byFix = useMemo(() => new Map(list.map((item) => [item.fixId, item])), [list])
  return { byFix, put }
}
