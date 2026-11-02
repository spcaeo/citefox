/**
 * Site structure (SRS 4.19) and Import pages (FR-20.6): sitemaps, sync rules
 * and reports, clusters, silos, groups, and the memberships other screens
 * slice by. Section 10 tables `sitemaps`, `clusters`, `cluster_pages`,
 * `groups`, and `group_pages` live in the project database.
 */

import { isOneOf } from './one-of'
import type { PageStatus } from './pages'

/** FR-19.2. How often the sitemap is read again. `manual` is "only on Sync now". */
const SITEMAP_SYNC_FREQUENCIES = ['daily', 'weekly', 'manual'] as const
export type SitemapSyncFrequency = (typeof SITEMAP_SYNC_FREQUENCIES)[number]

/** FR-19.2 new pages: add as not tracked, track with default markets, or ask me. */
const SITEMAP_NEW_RULES = ['add_untracked', 'track_default', 'ask'] as const
export type SitemapNewPageRule = (typeof SITEMAP_NEW_RULES)[number]

/** FR-19.2 removed pages: pause tracking and keep history, or delete. */
const SITEMAP_REMOVED_RULES = ['pause', 'delete'] as const
export type SitemapRemovedPageRule = (typeof SITEMAP_REMOVED_RULES)[number]

/** FR-19.2 changed lastmod: re-read and rerun gap analysis, re-read only, or nothing. */
const SITEMAP_CHANGED_RULES = ['reread_gaps', 'reread', 'nothing'] as const
export type SitemapChangedPageRule = (typeof SITEMAP_CHANGED_RULES)[number]

export interface SitemapSyncRules {
  frequency: SitemapSyncFrequency
  onNew: SitemapNewPageRule
  onRemoved: SitemapRemovedPageRule
  onChanged: SitemapChangedPageRule
}

export const DEFAULT_SITEMAP_SYNC_RULES: SitemapSyncRules = {
  frequency: 'manual',
  onNew: 'add_untracked',
  onRemoved: 'pause',
  onChanged: 'reread'
}

/** Where CiteFox learned about a sitemap. */
const SITEMAP_SOURCES = ['robots', 'guess', 'index', 'user'] as const
export type SitemapSource = (typeof SITEMAP_SOURCES)[number]

/** `index` lists other sitemaps. `urlset` lists pages. `unknown` before the first read. */
const SITEMAP_KINDS = ['index', 'urlset', 'unknown'] as const
export type SitemapKind = (typeof SITEMAP_KINDS)[number]

/** `pending` is "read on the next sync". */
const SITEMAP_READ_STATES = ['pending', 'read', 'error'] as const
export type SitemapReadState = (typeof SITEMAP_READ_STATES)[number]

/** One row of the Sitemaps table (FR-19.1). */
export interface SitemapRecord {
  id: string
  url: string
  /** The sitemap index that listed this one. Null for a top-level sitemap. */
  parentId: string | null
  kind: SitemapKind
  source: SitemapSource
  /** FR-19.1. A skipped sitemap is not read and its untracked pages are left out. */
  included: boolean
  state: SitemapReadState
  /** ISO-8601 UTC of the last successful read. */
  lastReadAt: string | null
  /** Newest `lastmod` in this sitemap, as written there (date or date-time). */
  lastChangedAt: string | null
  /** Page URLs listed (own domain only). For an index, the number of child sitemaps. */
  pageCount: number
  /** Plain-language failure from the last read. Null after a good read. */
  error: string | null
  /** True for names that are usually low value, such as tag or author sitemaps. */
  lowValue: boolean
}

/** What happened to one page in a sync (FR-19.3). */
const SYNC_PAGE_ACTIONS = [
  'added_untracked',
  'tracked',
  'awaiting_you',
  'paused',
  'removed',
  'reread_queued',
  'date_updated'
] as const
export type SyncPageAction = (typeof SYNC_PAGE_ACTIONS)[number]

export interface SyncPageChange {
  pageId: string | null
  url: string
  /** The sitemap file that listed it (or used to). */
  sitemapUrl: string | null
  lastmod: string | null
  /** True when the page was tracked (or set up) before this sync. */
  wasTracked: boolean
  action: SyncPageAction
  /** Cluster the page belongs to now. Null when it has none. */
  clusterName: string | null
}

const SYNC_TRIGGERS = ['first_read', 'manual', 'scheduled'] as const
export type SitemapSyncTrigger = (typeof SYNC_TRIGGERS)[number]

/** FR-19.3. One sync's report. Page lists are capped; the counts are not. */
export interface SitemapSyncReport {
  id: string
  trigger: SitemapSyncTrigger
  startedAt: string
  finishedAt: string
  /** `partial` when at least one included sitemap could not be read. */
  status: 'ok' | 'partial' | 'error'
  sitemapsRead: number
  sitemapsFailed: number
  /** Every own-domain page URL in the included sitemaps after this sync. */
  pageCount: number
  /** URLs ignored because they are on another domain. */
  otherDomainCount: number
  newCount: number
  removedCount: number
  changedCount: number
  newPages: readonly SyncPageChange[]
  removedPages: readonly SyncPageChange[]
  changedPages: readonly SyncPageChange[]
  /** Plain-language problems, one per failed sitemap. */
  problems: readonly string[]
  /** NFR-10. Set when the sync needs the user. */
  nextStep: string | null
}

/** Page roles in a cluster (FR-19.5). */
const CLUSTER_ROLES = ['pillar', 'supporting', 'orphan'] as const
export type ClusterRole = (typeof CLUSTER_ROLES)[number]

/**
 * Who made a cluster. Section 10 lists `claude` and `user`. `rules` is the
 * no-Claude grouping (URL folders, topic words, shared target queries).
 */
const CLUSTER_MAKERS = ['rules', 'claude', 'user'] as const
export type ClusterMaker = (typeof CLUSTER_MAKERS)[number]

/** FR-19.4 "Cluster by". `links` needs internal-link data CiteFox does not have yet. */
const CLUSTER_METHODS = ['topic', 'queries', 'links'] as const
export type ClusterMethod = (typeof CLUSTER_METHODS)[number]

export interface WeakestMarket {
  marketId: string
  score: number
}

/** One cluster card (FR-19.5, FR-20.8). Numbers come from the same rows as its page list. */
export interface ClusterSummary {
  id: string
  name: string
  madeBy: ClusterMaker
  /** True when the user renamed it, merged into it, or moved pages in or out. */
  editedByUser: boolean
  pillarPageId: string | null
  pillarTitle: string | null
  pillarUrl: string | null
  pageCount: number
  trackedCount: number
  /** Mean default-market score of tracked pages that have one. Null when none has. */
  averageScore: number | null
  /** Mean `change` of those pages. Null when no page has a previous check. */
  scoreChange: number | null
  weakestMarket: WeakestMarket | null
  /** Top AI Overview prompt themes: the most common prompt labels in the cluster. */
  themes: readonly string[]
  /**
   * The prompts behind each theme, in `themes` order, so a theme tag opens
   * exactly those prompts. Absent from older payloads.
   */
  themePrompts?: readonly ClusterTheme[]
  /** FR-19.5 "Track cluster". New pages the sync puts in this cluster are tracked too. */
  trackWhole: boolean
}

/** One active prompt behind a cluster theme. */
export interface ClusterThemePrompt {
  pageId: string
  promptId: string
  /** The prompt's number on its page (1-based). */
  position: number
  label: string
  /** The page's title, else its path. */
  pageLabel: string
}

export interface ClusterTheme {
  theme: string
  prompts: readonly ClusterThemePrompt[]
}

export interface ClusterPageRow {
  pageId: string
  url: string
  title: string | null
  role: ClusterRole
  movedByUser: boolean
  status: PageStatus
  score: number | null
}

/** A URL-folder silo (FR-19.6). `path` is like `/blog/` or `/industries/healthcare/`. */
export interface SiloSummary {
  path: string
  /** `/` for a top-level folder. Null for the site root row. */
  parentPath: string | null
  depth: number
  pageCount: number
  trackedCount: number
  /** FR-19.6. Ticking a silo tracks its pages, and pages the sitemap adds to it later. */
  trackAll: boolean
  /** Null is "Same as parent folder". The root's null is the project default market. */
  marketIds: readonly string[] | null
  /** The markets that apply after inheritance. */
  effectiveMarketIds: readonly string[]
}

/** A user-made list (FR-19.7). Claude never changes groups. */
export interface GroupSummary {
  id: string
  name: string
  note: string | null
  pageCount: number
  trackedCount: number
  averageScore: number | null
  createdAt: string
}

const INSIGHT_KINDS = ['cannibalization', 'orphan', 'thin_coverage', 'template_pages'] as const
export type StructureInsightKind = (typeof INSIGHT_KINDS)[number]

/** FR-19.8 "Claude noticed". Found by rules over stored data; no Claude call. */
export interface StructureInsight {
  id: string
  kind: StructureInsightKind
  title: string
  body: string
  /** The pages the flag is about, capped for the IPC payload. */
  pageIds: readonly string[]
  /** How many pages the flag is about in all; more than `pageIds.length` when capped. */
  pageCount: number
  /** The first few pages with a readable label (title, else path), for links. */
  pages: readonly { id: string; label: string }[]
  clusterId: string | null
}

/** Where one page sits. Other screens slice by this (All pages grid, reports). */
export interface PageMembership {
  pageId: string
  clusterId: string | null
  role: ClusterRole | null
  /** Deepest silo folder the page is in, like `/industries/healthcare/`. `/` for root pages. */
  siloPath: string
  groupIds: readonly string[]
  /** First seen in the latest sync. */
  isNew: boolean
  /** `lastmod` from the sitemap. Null for pages that are not in a sitemap. */
  lastmod: string | null
}

export interface StructureMemberships {
  projectId: string
  clusters: readonly { id: string; name: string }[]
  groups: readonly { id: string; name: string }[]
  silos: readonly string[]
  pages: readonly PageMembership[]
}

export function isSitemapSyncFrequency(value: string): value is SitemapSyncFrequency {
  return isOneOf(SITEMAP_SYNC_FREQUENCIES, value)
}

export function isSitemapNewPageRule(value: string): value is SitemapNewPageRule {
  return isOneOf(SITEMAP_NEW_RULES, value)
}

export function isSitemapRemovedPageRule(value: string): value is SitemapRemovedPageRule {
  return isOneOf(SITEMAP_REMOVED_RULES, value)
}

export function isSitemapChangedPageRule(value: string): value is SitemapChangedPageRule {
  return isOneOf(SITEMAP_CHANGED_RULES, value)
}

export function isSitemapSource(value: string): value is SitemapSource {
  return isOneOf(SITEMAP_SOURCES, value)
}

export function isSitemapKind(value: string): value is SitemapKind {
  return isOneOf(SITEMAP_KINDS, value)
}

export function isSitemapReadState(value: string): value is SitemapReadState {
  return isOneOf(SITEMAP_READ_STATES, value)
}

export function isSyncPageAction(value: string): value is SyncPageAction {
  return isOneOf(SYNC_PAGE_ACTIONS, value)
}

export function isSitemapSyncTrigger(value: string): value is SitemapSyncTrigger {
  return isOneOf(SYNC_TRIGGERS, value)
}

export function isClusterRole(value: string): value is ClusterRole {
  return isOneOf(CLUSTER_ROLES, value)
}

export function isClusterMaker(value: string): value is ClusterMaker {
  return isOneOf(CLUSTER_MAKERS, value)
}

export function isClusterMethod(value: string): value is ClusterMethod {
  return isOneOf(CLUSTER_METHODS, value)
}

export function isStructureInsightKind(value: string): value is StructureInsightKind {
  return isOneOf(INSIGHT_KINDS, value)
}
