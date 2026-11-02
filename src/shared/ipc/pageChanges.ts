/**
 * Page change history: every read of a tracked page with the dates the page
 * states about itself, the versions it went through, and the changes CiteFox
 * noticed between two reads. A change nobody logged as a fix asks "Is this a
 * fix?" on Pages and shows as a dashed "?" marker on the charts. Read from the
 * page reads CiteFox already makes: no searches, no AI.
 */

import type { BlockDiffCounts, BlockDiffItem } from '../page-diff'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/**
 * `open`: nobody said what it was yet. `linked`: a fix on the page goes live
 * within 3 days of it. `dismissed`: "Not a fix" (a typo, a design change).
 */
export type PageChangeState = 'open' | 'linked' | 'dismissed'

/** One change CiteFox saw on a page between two reads. */
export interface PageChange {
  /** Opaque id. */
  id: string
  pageId: string
  url: string
  /** The page's label, else its title, else null (show the path). */
  label: string | null
  /** ISO-8601 UTC: the read that saw it. */
  detectedAt: string
  /**
   * ISO-8601 UTC: the day it most likely went live: the page's own new "Updated"
   * date when it moved between the two reads, else `detectedAt`.
   */
  changedAt: string
  /** The "Updated" date the page states now, when it moved with this change. */
  modifiedAt: string | null
  /** The "Updated" date the page stated before. */
  previousModifiedAt: string | null
  fromSnapshotId: string
  toSnapshotId: string
  counts: BlockDiffCounts
  /** "2 sections are new, 1 heading changed." */
  sentence: string
  /** The headings of the sections that changed, in page order. */
  sections: readonly string[]
  state: PageChangeState
  /** The fix it is linked to (`linked`). */
  fixId: string | null
  fixNumber: number | null
  /** ISO-8601 UTC "Not a fix" was picked. */
  dismissedAt: string | null
}

/** The dates a page states about itself, from its latest read. */
export interface PageReadDates {
  pageId: string
  /** `article:published_time`, JSON-LD `datePublished` or a visible "Published on". */
  publishedAt: string | null
  /** `article:modified_time`, JSON-LD `dateModified` or a visible "Updated on". */
  modifiedAt: string | null
  /** ISO-8601 UTC of the latest read. */
  readAt: string
}

/** `pageChanges:list`: the project's changes, newest first, and every page's dates. */
export interface PageChangeList {
  projectId: string
  builtAt: string
  changes: readonly PageChange[]
  dates: readonly PageReadDates[]
}

/** `pageChanges:versions`. */
export interface PageVersionsRequest {
  projectId: string
  pageId: string
}

/** One version of a page: reads with the same text, from first seen to last seen. */
export interface PageVersion {
  snapshotId: string
  /** ISO-8601 UTC. */
  firstReadAt: string
  lastReadAt: string
  reads: number
  /** The dates the page stated at its latest read of this version. */
  publishedAt: string | null
  modifiedAt: string | null
  wordCount: number
  /** What changed since the version before. Null for the oldest one kept. */
  previousSnapshotId: string | null
  counts: BlockDiffCounts | null
  sentence: string | null
  /** The change CiteFox noticed for it, when there is one. */
  change: PageChange | null
}

/** `pageChanges:versions`: newest first, at most the 24 kept. */
export interface PageVersionList {
  pageId: string
  url: string
  versions: readonly PageVersion[]
}

/** `pageChanges:diff`: two versions of one page. */
export interface PageDiffRequest {
  projectId: string
  pageId: string
  fromSnapshotId: string
  toSnapshotId: string
}

export interface PageVersionStamp {
  snapshotId: string
  /** ISO-8601 UTC of the read. */
  readAt: string
  modifiedAt: string | null
  wordCount: number
}

export interface PageDiffResult {
  pageId: string
  url: string
  from: PageVersionStamp
  to: PageVersionStamp
  items: readonly BlockDiffItem[]
  counts: BlockDiffCounts
  sentence: string
  /** A short description for "Log as fix". */
  fixText: string
}

/** `pageChanges:dismiss` and `pageChanges:restore` (Undo). */
export interface PageChangeIdRequest {
  projectId: string
  changeId: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const pageChangesChannels = {
  'pageChanges:list': invokeWith<ProjectIdRequest, PageChangeList>(),
  'pageChanges:versions': invokeWith<PageVersionsRequest, PageVersionList>(),
  'pageChanges:diff': invokeWith<PageDiffRequest, PageDiffResult>(),
  'pageChanges:dismiss': invokeWith<PageChangeIdRequest, PageChange>(),
  'pageChanges:restore': invokeWith<PageChangeIdRequest, PageChange>()
} as const satisfies InvokeChannelSpecs
