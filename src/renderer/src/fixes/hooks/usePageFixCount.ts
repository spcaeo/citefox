import { useEffect, useMemo, useState } from 'react'
import { useChangeVersion } from '../../shell/changes'
import { onTopicsChanged } from '../../topics/clusters/events'
import { createProjectFixesSource, type ProjectFixesSource } from '../source'

/**
 * The sidebar Fixes badge: page fixes to do in the open project (`fixes:pageFixCount`).
 * Null without a project, while loading, or when the count can't be read (the
 * sidebar never shows an error; a failed reload keeps the last count). Reloads
 * after each finished check, when topics change and when fixes change (`notifyChanged`).
 */
export function usePageFixCount(
  projectId: string | null,
  /** The shell's engine revision (the sidebar sits outside its context). */
  revision: number,
  source?: Pick<ProjectFixesSource, 'fixes:pageFixCount'>,
  /** `topics`: only the fixes a topic feeds (the Topics dashboard). */
  scope: 'all' | 'topics' = 'all'
): number | null {
  const resolved = useMemo(() => source ?? createProjectFixesSource(), [source])
  const fixes = useChangeVersion('fixes')
  const [changed, setChanged] = useState(0)
  useEffect(() => onTopicsChanged(() => setChanged((value) => value + 1)), [])
  const [state, setState] = useState<{ projectId: string | null; count: number | null }>({
    projectId: null,
    count: null
  })

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    resolved['fixes:pageFixCount']({ projectId }).then(
      (result) => {
        if (!cancelled) {
          setState({ projectId, count: scope === 'topics' ? result.topicFixes : result.pageFixes })
        }
      },
      () => {
        // Keep what the sidebar already shows.
      }
    )
    return () => {
      cancelled = true
    }
  }, [resolved, projectId, revision, changed, fixes, scope])

  return projectId && state.projectId === projectId ? state.count : null
}
