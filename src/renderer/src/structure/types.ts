import type { ClusterMaker, ClusterRole, Market } from '@shared/domain'
import type { SortSpec } from '../utils/sort'

/** The three ways to organise pages (FR-19.4 to FR-19.7). */
export type StructureViewId = 'clusters' | 'silos' | 'groups'

/** Clusters grid presentation, the same three modes as All pages. */
export type ClusterMode = 'cards' | 'table' | 'tree'

/** "Tracking" facet: whole cluster, some pages, or none. */
export type ClusterTracking = 'whole' | 'some' | 'none'

export interface ClusterFilter {
  tracking: readonly ClusterTracking[]
  madeBy: readonly ClusterMaker[]
}

export type ClusterSortKey = 'name' | 'pages' | 'tracked' | 'score'
export type ClusterSort = SortSpec<ClusterSortKey>

export type SitemapSortKey = 'file' | 'urls' | 'changed' | 'status'
export type SitemapSort = SortSpec<SitemapSortKey>

export type ClusterPageSortKey = 'page' | 'role' | 'score' | 'tracked'
export type ClusterPageSort = SortSpec<ClusterPageSortKey>

export type RoleFilter = ClusterRole | 'all'

/** Markets the screen can offer for silo defaults and tracking labels. */
export interface MarketChoice {
  id: string
  label: string
  market: Market | null
}

/** Runs one engine call, then reloads. Resolves the result, or null after an error. */
export type RunAction = <T>(label: string, call: () => Promise<T>) => Promise<T | null>
