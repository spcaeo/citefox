import { useEffect, useState } from 'react'
import type { DueList } from '@shared/domain'
import type { ClusterSummaryList } from '@shared/ipc'
import type { AllPagesSource } from '../source'

export interface ProjectExtras {
  /** `schedule:listDue` for the project. Null while loading or when it failed. */
  due: DueList | null
  /** `structure:clusterSummary`. Null while loading, when it failed, or with no clusters. */
  clusters: ClusterSummaryList | null
}

/**
 * The pages due today and the cluster table. Both are extras: a failure
 * leaves the tile on its summary number and hides the cluster table.
 */
export function useProjectExtras(
  source: AllPagesSource,
  projectId: string | null,
  revision: unknown
): ProjectExtras {
  const [due, setDue] = useState<{ projectId: string; list: DueList } | null>(null)
  const [clusters, setClusters] = useState<{
    projectId: string
    list: ClusterSummaryList
  } | null>(null)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    source.due(projectId).then(
      (list) => {
        if (!cancelled) setDue({ projectId, list })
      },
      () => {
        if (!cancelled) setDue(null)
      }
    )
    source.clusters(projectId).then(
      (list) => {
        if (!cancelled) setClusters({ projectId, list })
      },
      () => {
        if (!cancelled) setClusters(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, revision])

  return {
    due: due && due.projectId === projectId ? due.list : null,
    clusters:
      clusters && clusters.projectId === projectId && clusters.list.clusters.length > 0
        ? clusters.list
        : null
  }
}
