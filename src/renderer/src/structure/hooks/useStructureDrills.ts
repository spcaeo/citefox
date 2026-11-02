import { useMemo } from 'react'
import type { ClusterSummary, GroupSummary, SiloSummary } from '@shared/domain'
import type { ImportCandidateList } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { ItemDrill } from '../../drill'
import type { StructureClient } from '../client'
import { isTrackedStatus } from '../utils/model'
import { candidatePage, inSilo, pagesDrill, scoresDrill, type DrillPage } from '../utils/drills'

/**
 * Loads the rows behind Site structure's numbers. Each loader returns the
 * drawer for exactly the count it stands for (NFR-14). `revision` (the view)
 * drops the cached page list after an action.
 */
export interface StructureDrills {
  candidates: () => Promise<ImportCandidateList>
  clusterPages: (cluster: ClusterSummary, part: 'all' | 'tracked') => Promise<ItemDrill>
  clusterScores: (cluster: ClusterSummary) => Promise<ItemDrill>
  groupPages: (group: GroupSummary, part: 'all' | 'tracked') => Promise<ItemDrill>
  groupScores: (group: GroupSummary) => Promise<ItemDrill>
  siloPages: (silo: SiloSummary, part: 'all' | 'tracked') => Promise<ItemDrill>
  /** Pages by id, labelled from the project's page list (an insight's pages). */
  pagesById: (
    copy: { id: string; title: string; description: string },
    pageIds: readonly string[]
  ) => Promise<ItemDrill>
}

export function useStructureDrills(
  client: StructureClient,
  projectId: string,
  revision: unknown
): StructureDrills {
  return useMemo(() => {
    void revision
    const cache: { list: Promise<ImportCandidateList> | null } = { list: null }
    const candidates = (): Promise<ImportCandidateList> => {
      if (!cache.list) {
        const list = client['import:candidates']({ projectId })
        list.catch(() => {
          cache.list = null
        })
        cache.list = list
      }
      return cache.list
    }
    const clusterRows = async (cluster: ClusterSummary): Promise<DrillPage[]> => {
      const list = await client['structure:clusterPages']({ projectId, clusterId: cluster.id })
      return list.pages.map((page) => ({ ...page }))
    }
    const groupRows = async (group: GroupSummary): Promise<DrillPage[]> => {
      const list = await client['structure:groupPages']({ projectId, groupId: group.id })
      return list.pages.map((page) => ({ ...page }))
    }
    const part = (pages: readonly DrillPage[], which: 'all' | 'tracked'): DrillPage[] =>
      which === 'all' ? [...pages] : pages.filter((page) => isTrackedStatus(page.status))
    return {
      candidates,
      clusterPages: async (cluster, which) =>
        pagesDrill({
          id: `cluster-${which === 'all' ? 'pages' : 'tracked'}:${cluster.id}`,
          title: which === 'all' ? `Pages in ${cluster.name}` : `Tracked pages in ${cluster.name}`,
          description:
            which === 'all'
              ? `Every page in this cluster. Manage roles and moves with “Show pages”.`
              : `Pages in this cluster that are tracked, setting up or paused.`,
          pages: part(await clusterRows(cluster), which)
        }),
      clusterScores: async (cluster) =>
        scoresDrill({
          id: `cluster-score:${cluster.id}`,
          name: cluster.name,
          average: cluster.averageScore,
          pages: await clusterRows(cluster)
        }),
      groupPages: async (group, which) =>
        pagesDrill({
          id: `group-${which === 'all' ? 'pages' : 'tracked'}:${group.id}`,
          title: which === 'all' ? `Pages in ${group.name}` : `Tracked pages in ${group.name}`,
          description:
            which === 'all'
              ? 'Every page in this group.'
              : 'Pages in this group that are tracked, setting up or paused.',
          pages: part(await groupRows(group), which)
        }),
      groupScores: async (group) =>
        scoresDrill({
          id: `group-score:${group.id}`,
          name: group.name,
          average: group.averageScore,
          pages: await groupRows(group)
        }),
      siloPages: async (silo, which) => {
        const list = await candidates()
        const pages = list.rows.filter((row) => inSilo(row, silo.path)).map(candidatePage)
        return pagesDrill({
          id: `silo-${which === 'all' ? 'pages' : 'tracked'}:${silo.path}`,
          title: which === 'all' ? `Pages in ${silo.path}` : `Tracked pages in ${silo.path}`,
          description:
            which === 'all'
              ? `Every page in this folder and the folders under it.`
              : `Pages in this folder and the folders under it that are tracked, setting up or paused.`,
          pages: part(pages, which)
        })
      },
      pagesById: async (copy, pageIds) => {
        const list = await candidates()
        const byId = new Map(list.rows.map((row) => [row.pageId, row]))
        const pages = pageIds.map((pageId): DrillPage => {
          const row = byId.get(pageId)
          return row
            ? candidatePage(row)
            : { pageId, url: '', title: 'A page no longer in your sitemaps', status: 'removed' }
        })
        return pagesDrill({
          ...copy,
          description: `${copy.description} ${pluralize(pages.length, 'page')}.`,
          pages
        })
      }
    }
  }, [client, projectId, revision])
}
