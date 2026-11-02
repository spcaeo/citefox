/** Pages, pins, search, and the page read. */

import type {
  IntervalDays,
  Market,
  OutlineEntry,
  PageEligibility,
  PageFaq,
  PagePromiseSummary,
  PageReadFlag,
  PageReadMethod,
  PageReadPhase,
  PageReadReader,
  PageSummary,
  SampleCount,
  WorkProgressState
} from '../domain'
import { invokeWith, push, type InvokeChannelSpecs, type PushChannelSpecs } from './contract'
import type { MarketDraft, ProjectIdRequest } from './projects'

export interface PageIdRequest {
  projectId: string
  pageId: string
}

/** `pages:list`. Working pages only. See the channel note. */
export interface PageList {
  foundPageCount: number
  pages: readonly PageSummary[]
}

/** The page header: the summary plus its markets and latest snapshot. */
export interface PageDetail extends PageSummary {
  markets: readonly Market[]
  /** Latest read. Null before the first successful read. */
  snapshotId: string | null
}

/**
 * `pages:add` (FR-1.2). One URL.
 * An empty `markets` list means the project's default market only (FR-1.3).
 * Import pages is M5 and is not this channel.
 */
export interface AddPageRequest {
  projectId: string
  url: string
  markets: readonly MarketDraft[]
  intervalDays: IntervalDays
  samples: SampleCount
  promptCount: number
  /**
   * Add and check now: the page's first check starts by itself once its setup
   * (read, buyer profile, questions) is ready. Omitted: it waits for the user.
   */
  checkWhenReady?: boolean
}

/** Arguments for `pages:update`. Omitted fields stay as they are. */
export interface UpdatePageRequest {
  projectId: string
  pageId: string
  url?: string
  label?: string | null
  intervalDays?: IntervalDays
  samples?: SampleCount
  promptCount?: number
  defaultMarketId?: string
  /**
   * Replaces the page's markets when present.
   * The engine rejects an empty list (FR-1.3 requires one market).
   */
  markets?: readonly MarketDraft[]
  /** `removed` is `pages:remove`. `not_tracked` is not set from here. */
  status?: 'setting_up' | 'tracked' | 'paused'
}

export interface RemovePageResult {
  id: string
  status: 'removed'
}

/**
 * Sidebar page search. `query` is matched against title, label, and URL.
 * A blank query returns `foundPageCount` and an empty `pages` list.
 */
export interface SearchPagesRequest {
  projectId: string
  query: string
}

export interface SearchPagesResult {
  foundPageCount: number
  pages: readonly PageSummary[]
}

/**
 * One pinned sidebar row (FR-20.9).
 * Pin order is oldest first. `score` is null until M3.
 */
export interface PinnedPage {
  id: string
  projectId: string
  label: string | null
  title: string | null
  url: string
  score: number | null
  intervalDays: IntervalDays
  samples: SampleCount
  promptSetVersion: number | null
  promptCount: number
  markets: readonly Market[]
  setupStep: PageSummary['setupStep']
}

export interface PinnedPageList {
  pages: readonly PinnedPage[]
}

/**
 * `pages:readStart`.
 * `suppliedText` is write-only page text for `reader: 'file'` (FR-2.9).
 * It is never a field on a result. It is not a keychain secret.
 */
export interface StartPageReadRequest {
  projectId: string
  pageId: string
  reader: PageReadReader
  suppliedText: string | null
}

/** Pushed while `pages:readStart` is in flight, once per phase change. */
export interface PageReadProgress {
  pageId: string
  phase: PageReadPhase
  state: WorkProgressState
  detail: string
  /** NFR-10. Null unless `state` is `warning`. */
  nextStep: string | null
}

/**
 * What the page-read screen shows (FR-2.1 through FR-2.4, FR-2.7, FR-8.1).
 * The body stays in the project database. This result is a summary and metadata.
 * No secrets, and no `suppliedText`.
 */
export interface PageReadResult {
  /** Snapshot read id. Null when the read failed and no snapshot was stored. */
  id: string | null
  pageId: string
  /** ISO-8601 UTC (NFR-15). */
  fetchedAt: string
  method: PageReadMethod
  /** Null for a file read, and when the fetch did not get a status. */
  httpStatus: number | null
  durationMs: number
  title: string | null
  titleLength: number
  metaDescription: string | null
  metaDescriptionLength: number
  h1: string | null
  titleMatchesH1: boolean | null
  canonical: string | null
  canonicalMatchesPage: boolean | null
  publishedAt: string | null
  modifiedAt: string | null
  h2Count: number
  h3Count: number
  tableCount: number
  outline: readonly OutlineEntry[]
  faqs: readonly PageFaq[]
  wordCount: number
  /**
   * Lowercase SHA-256 hex of the normalized body (FR-2.3). The UI may shorten it.
   * Null when the read failed and no snapshot was stored.
   */
  contentHash: string | null
  /**
   * True when this read reused an existing snapshot because the content hash
   * was unchanged. False when a new snapshot was stored.
   */
  snapshotReused: boolean
  flags: readonly PageReadFlag[]
  /**
   * Whether Google may show and quote the page in AI Overviews (robots meta,
   * X-Robots-Tag, data-nosnippet). Null when the read did not see the page's HTML.
   */
  eligibility: PageEligibility | null
  /** Null when the summary phase did not run. */
  summary: PagePromiseSummary | null
  message: string
  /** NFR-10. Set when the read needs the user. Null on success. */
  nextStep: string | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const pagesChannels = {
  'pages:list': invokeWith<ProjectIdRequest, PageList>(),
  'pages:get': invokeWith<PageIdRequest, PageDetail>(),
  'pages:add': invokeWith<AddPageRequest, PageDetail>(),
  'pages:update': invokeWith<UpdatePageRequest, PageDetail>(),
  'pages:remove': invokeWith<PageIdRequest, RemovePageResult>(),
  'pages:search': invokeWith<SearchPagesRequest, SearchPagesResult>(),
  'pages:pin': invokeWith<PageIdRequest, PinnedPage>(),
  'pages:unpin': invokeWith<PageIdRequest, PageSummary>(),
  'pages:pinned': invokeWith<ProjectIdRequest, PinnedPageList>(),
  'pages:readStart': invokeWith<StartPageReadRequest, PageReadResult>(),
  'pages:getRead': invokeWith<PageIdRequest, PageReadResult | null>()
} as const satisfies InvokeChannelSpecs

/** Push events for this area. */
export const pagesEvents = {
  'pages:readProgress': push<PageReadProgress>()
} as const satisfies PushChannelSpecs
