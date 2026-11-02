/**
 * Sitemaps and sync (FR-19.1 to FR-19.3), Import pages (FR-20.6), and site
 * structure: clusters, silos, groups, and "Claude noticed" (FR-19.4 to
 * FR-19.8, FR-20.8). `structure:listMemberships` is the read other screens
 * use to slice pages by cluster, silo, and group.
 */

import type {
  ClusterMethod,
  ClusterPageRow,
  ClusterRole,
  ClusterSummary,
  GroupSummary,
  IntervalDays,
  Market,
  PageStatus,
  SampleCount,
  SiloSummary,
  SitemapRecord,
  SitemapSyncReport,
  SitemapSyncRules,
  StructureInsight,
  StructureMemberships
} from '../domain'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'
import type { MarketDraft, ProjectIdRequest } from './projects'

// ---------- Sitemaps ----------

/** The Sitemaps card and sync settings on Site structure. */
export interface SitemapOverview {
  projectId: string
  sitemaps: readonly SitemapRecord[]
  rules: SitemapSyncRules
  /** Every page row in the project except removed ones (FR-20.2 "found"). */
  foundPageCount: number
  /** Pages that are tracked, setting up, or paused. */
  trackedPageCount: number
  lastSync: SitemapSyncReport | null
  /** ISO-8601 UTC. Null when sync is manual or never ran. */
  nextSyncAt: string | null
  /** True while a sync for this project is running. */
  syncing: boolean
}

/**
 * `sitemaps:discover`. With `url` null, CiteFox reads `robots.txt` on the
 * project domain (then `/sitemap.xml` and `/sitemap_index.xml`). With a URL,
 * that sitemap is added and read. Either way the result is the sync report.
 */
export interface DiscoverSitemapsRequest {
  projectId: string
  url: string | null
}

export interface SitemapUrlRequest {
  projectId: string
  url: string
}

export interface SitemapIdRequest {
  projectId: string
  sitemapId: string
}

export interface SetSitemapIncludedRequest {
  projectId: string
  sitemapId: string
  included: boolean
}

export interface SetSitemapRulesRequest {
  projectId: string
  rules: SitemapSyncRules
}

/** Pushed when a sync finishes, including a scheduled one. */
export interface SitemapSyncFinished {
  projectId: string
  report: SitemapSyncReport
}

// ---------- Import pages ----------

/** One row of the Import pages preview. A pasted or CSV URL not in the project has no page id. */
export interface ImportCandidate {
  pageId: string | null
  url: string
  /** Path and query, like `/blog/10dlc-registration-guide/`. */
  path: string
  title: string | null
  /** Top-level folder like `/blog/`, or `/` for pages at the root. */
  folder: string
  clusterId: string | null
  clusterName: string | null
  lastmod: string | null
  /** Null when CiteFox has no internal-link data. */
  internalLinks: number | null
  /** Pricing, product, features, compare, or alternatives URL (FR-20.6 money pages). */
  moneyPage: boolean
  /** Tracked, setting up, or paused. These keep their markets and history. */
  alreadyTracked: boolean
  status: PageStatus | null
  /** True until the page has a read, a buyer profile, and prompts (Claude work to set up). */
  needsSetup: boolean
  /** Ids of the sitemaps that list this page now (Site structure's URL-count drill). */
  sitemapIds?: readonly string[]
  /** Deepest Site structure silo the page is in, like `/blog/` (`/` for root pages). */
  siloPath?: string
  /** The label an imported file's Label column gave the page (Import pages). Absent otherwise. */
  label?: string | null
}

export interface ImportFolderCount {
  folder: string
  pageCount: number
  trackedCount: number
}

export interface ImportCandidateList {
  projectId: string
  /** Every page found in the included sitemaps, not removed. */
  rows: readonly ImportCandidate[]
  folders: readonly ImportFolderCount[]
  clusters: readonly { id: string; name: string; pageCount: number }[]
  /** False until CiteFox stores internal links. The quick pick is then unavailable. */
  hasLinkData: boolean
  sitemapCount: number
  skippedSitemaps: readonly string[]
  trackedCount: number
  /** Every market in the project, default first, for "Markets" in How to track. */
  markets: readonly Market[]
}

export interface ParseImportUrlsRequest {
  projectId: string
  /** Pasted text (one URL per line), or the CSV file's text. */
  text: string
  format: 'lines' | 'csv'
}

export interface ImportRejection {
  /** 1-based line or CSV row. */
  line: number
  value: string
  reason: string
}

export interface ParsedImportUrls {
  rows: readonly ImportCandidate[]
  rejected: readonly ImportRejection[]
  /** Lines that repeated a URL already in `rows`. */
  duplicates: number
}

/** FR-20.6 cost estimate. Searches use FR-1.6: prompts × markets × samples × 1–2. */
export interface ImportEstimateRequest {
  projectId: string
  pageCount: number
  /** Pages that still need a page read, buyer profile, and prompts. */
  setupPageCount: number
  marketCount: number
  promptCount: number
  samples: SampleCount
  intervalDays: IntervalDays
  stagger: boolean
}

export interface ImportEstimate {
  minSearches: number
  maxSearches: number
  /** Checks a month at this interval (30 / interval, at least 1 for 14 days → 2). */
  checksPerMonth: number
  monthlyMin: number
  monthlyMax: number
  /** Searches left this month across tested keys. Null when unknown. */
  searchesLeft: number | null
  /** Monthly allowance (plan or cap, the tighter). Null when unknown. */
  monthlyPlan: number | null
  /** Over 7 days when staggered, else the first day. */
  perDayMin: number
  perDayMax: number
  firstRoundFits: boolean | null
  monthlyFits: boolean | null
  /** Claude calls to set the pages up: page summary, buyer profile, and prompts per page. */
  claudeCalls: number
}

/**
 * `import:track`. `pageIds` are existing pages (not tracked yet). `urls` are
 * pasted or CSV URLs that are not in the project; they are added first.
 * Already-tracked pages in either list are left as they are.
 * An empty `markets` list means the project default market.
 */
export interface ImportTrackRequest {
  projectId: string
  pageIds: readonly string[]
  urls: readonly string[]
  markets: readonly MarketDraft[]
  intervalDays: IntervalDays
  samples: SampleCount
  promptCount: number
  stagger: boolean
  /**
   * Labels from an imported file's Label column, by URL. A page that has no label
   * yet takes its file label; a label set in CiteFox is kept.
   */
  labels?: readonly { url: string; label: string }[]
}

export interface ImportTrackResult {
  trackedCount: number
  addedCount: number
  skippedCount: number
  /** ISO-8601 UTC. First and last first-check dates. Null when nothing was tracked. */
  firstCheckFrom: string | null
  firstCheckUntil: string | null
}

/** "Claude's pick" (FR-20.6). */
export interface ClaudePickRequest {
  projectId: string
  /** Optional "Tell Claude what to change". */
  instruction: string | null
}

export interface ClaudePickResult {
  pageIds: readonly string[]
  /** One line per reason, in plain words. */
  reasons: readonly string[]
}

// ---------- Structure ----------

export interface StructureView {
  projectId: string
  clusters: readonly ClusterSummary[]
  silos: readonly SiloSummary[]
  groups: readonly GroupSummary[]
  insights: readonly StructureInsight[]
  /** True when a previous set of clusters is saved for undo. */
  canUndoClusters: boolean
  lastClusteredAt: string | null
  lastClusterMethod: ClusterMethod | null
  /** Methods that can run with the data CiteFox has. */
  availableMethods: readonly ClusterMethod[]
  foundPageCount: number
  trackedPageCount: number
  /** Every market in the project, default first (silo default markets, track labels). */
  markets: readonly Market[]
}

export interface ClusterIdRequest {
  projectId: string
  clusterId: string
}

export interface ClusterPageList {
  clusterId: string
  pages: readonly ClusterPageRow[]
}

export interface ReclusterRequest {
  projectId: string
  method: ClusterMethod
  /** "Auto-cluster with Claude". False uses the rules only. */
  useClaude: boolean
  instruction: string | null
}

export interface ReclusterResult {
  view: StructureView
  previousCount: number
  /** Plain lines: new clusters, moves, and what was kept. */
  changes: readonly string[]
}

export interface RenameClusterRequest {
  projectId: string
  clusterId: string
  name: string
}

export interface MergeClustersRequest {
  projectId: string
  fromClusterId: string
  intoClusterId: string
}

export interface MovePageRequest {
  projectId: string
  pageId: string
  clusterId: string
}

/**
 * `structure:movePages`: many pages into one cluster at once. `clusterId`
 * null takes them out of their clusters (Unclustered). Saved for
 * `structure:undoClusters`.
 */
export interface MovePagesRequest {
  projectId: string
  pageIds: readonly string[]
  clusterId: string | null
}

/**
 * `structure:createCluster`: a cluster the user makes (made by "You"). The
 * picked pages move out of their old clusters into it. Saved for undo.
 */
export interface CreateClusterRequest {
  projectId: string
  name: string
  pageIds: readonly string[]
}

/**
 * `structure:splitCluster`: the picked pages of one cluster move to a new
 * cluster with this name. Every picked page must be in `clusterId`, and at
 * least one page must stay behind. Saved for undo.
 */
export interface SplitClusterRequest {
  projectId: string
  clusterId: string
  name: string
  pageIds: readonly string[]
}

/** What `structure:createCluster` and `structure:splitCluster` made. */
export interface ClusterChangeResult {
  view: StructureView
  /** The new cluster. */
  clusterId: string
  /** Pages that moved into it. */
  movedCount: number
}

export interface SetPageRoleRequest {
  projectId: string
  clusterId: string
  pageId: string
  role: ClusterRole
}

/** Track or stop tracking a whole cluster. Tracking uses the project default market. */
export interface TrackClusterRequest {
  projectId: string
  clusterId: string
  track: boolean
}

export interface TrackStructureResult {
  view: StructureView
  trackedCount: number
}

/** Omitted fields stay. `marketIds` null is "Same as parent folder". */
export interface SetSiloRequest {
  projectId: string
  path: string
  trackAll?: boolean
  marketIds?: readonly string[] | null
}

export interface CreateGroupRequest {
  projectId: string
  name: string
  note: string | null
}

export interface GroupIdRequest {
  projectId: string
  groupId: string
}

export interface RenameGroupRequest {
  projectId: string
  groupId: string
  name: string
  note: string | null
}

export interface SetGroupPagesRequest {
  projectId: string
  groupId: string
  add: readonly string[]
  remove: readonly string[]
}

export interface GroupPageRow {
  pageId: string
  url: string
  title: string | null
  status: PageStatus
  score: number | null
}

export interface GroupPageList {
  groupId: string
  pages: readonly GroupPageRow[]
}

/** FR-20.8 cluster summary for All pages: the largest clusters first. */
export interface ClusterSummaryRequest {
  projectId: string
  limit: number
}

export interface ClusterSummaryList {
  clusters: readonly ClusterSummary[]
  totalClusters: number
}

/** FR-19.8 "Suggest internal links". */
export interface InternalLinkSuggestion {
  fromPageId: string
  fromUrl: string
  toPageId: string
  toUrl: string
  anchor: string
  where: string
}

export interface InternalLinkSuggestions {
  clusterId: string
  links: readonly InternalLinkSuggestion[]
}

/** Invoke channels for this area. Each one is declared here only. */
export const structureChannels = {
  'sitemaps:get': invokeWith<ProjectIdRequest, SitemapOverview>(),
  'sitemaps:discover': invokeWith<DiscoverSitemapsRequest, SitemapSyncReport>(),
  'sitemaps:add': invokeWith<SitemapUrlRequest, SitemapOverview>(),
  'sitemaps:remove': invokeWith<SitemapIdRequest, SitemapOverview>(),
  'sitemaps:setIncluded': invokeWith<SetSitemapIncludedRequest, SitemapOverview>(),
  'sitemaps:setRules': invokeWith<SetSitemapRulesRequest, SitemapOverview>(),
  'sitemaps:sync': invokeWith<ProjectIdRequest, SitemapSyncReport>(),
  'import:candidates': invokeWith<ProjectIdRequest, ImportCandidateList>(),
  'import:parseUrls': invokeWith<ParseImportUrlsRequest, ParsedImportUrls>(),
  'import:estimate': invokeWith<ImportEstimateRequest, ImportEstimate>(),
  'import:claudePick': invokeWith<ClaudePickRequest, ClaudePickResult>(),
  'import:track': invokeWith<ImportTrackRequest, ImportTrackResult>(),
  'structure:get': invokeWith<ProjectIdRequest, StructureView>(),
  'structure:clusterPages': invokeWith<ClusterIdRequest, ClusterPageList>(),
  'structure:recluster': invokeWith<ReclusterRequest, ReclusterResult>(),
  'structure:undoClusters': invokeWith<ProjectIdRequest, StructureView>(),
  'structure:renameCluster': invokeWith<RenameClusterRequest, StructureView>(),
  'structure:mergeClusters': invokeWith<MergeClustersRequest, StructureView>(),
  'structure:movePage': invokeWith<MovePageRequest, StructureView>(),
  'structure:movePages': invokeWith<MovePagesRequest, StructureView>(),
  'structure:createCluster': invokeWith<CreateClusterRequest, ClusterChangeResult>(),
  /** Deletes a cluster; its pages become Unclustered. Saved for `structure:undoClusters`. */
  'structure:deleteCluster': invokeWith<ClusterIdRequest, StructureView>(),
  'structure:splitCluster': invokeWith<SplitClusterRequest, ClusterChangeResult>(),
  'structure:setPageRole': invokeWith<SetPageRoleRequest, StructureView>(),
  'structure:trackCluster': invokeWith<TrackClusterRequest, TrackStructureResult>(),
  'structure:setSilo': invokeWith<SetSiloRequest, TrackStructureResult>(),
  'structure:createGroup': invokeWith<CreateGroupRequest, GroupSummary>(),
  'structure:renameGroup': invokeWith<RenameGroupRequest, GroupSummary>(),
  'structure:deleteGroup': invokeWith<GroupIdRequest, StructureView>(),
  'structure:setGroupPages': invokeWith<SetGroupPagesRequest, GroupSummary>(),
  'structure:groupPages': invokeWith<GroupIdRequest, GroupPageList>(),
  'structure:listMemberships': invokeWith<ProjectIdRequest, StructureMemberships>(),
  'structure:clusterSummary': invokeWith<ClusterSummaryRequest, ClusterSummaryList>(),
  'structure:suggestLinks': invokeWith<ClusterIdRequest, InternalLinkSuggestions>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const structureEvents = {
  'sitemaps:syncFinished': push<SitemapSyncFinished>()
} as const satisfies PushChannelSpecs
