/**
 * Fix → measure → repeat: the Changes ledger, the next round, Google index checks,
 * the backlink ask list and Lost ground. Read from stored checks and page reads; the
 * only call that spends searches is `fixes:checkIndex`, after the person confirms.
 */

import type { FixKind, Market, PromptCheckRow } from '../domain'
import type { ChangeStatus, IndexState, LoopStep } from '../fix-loop'
import type { FixMeasure } from '../fix-verdict'
import type { OutlineDiff } from '../outline-diff'
import type { ProjectSearches } from '../page-fixes'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { DraftOwnerWhyRequest, OwnerWhyRequest, OwnerWhyResult } from './ownerWhy'
import type { ProjectIdRequest } from './projects'

/** One stored full check of a page in its default market, as Results scores it. */
export interface ChangeCheck {
  runId: string
  marketId: string
  /** ISO-8601 UTC when the check finished. */
  checkedAt: string
  /** Every question of that check, in prompt order. */
  rows: readonly PromptCheckRow[]
}

/** The dates the live page states about itself, from the latest page read. */
export interface PageDates {
  /** `article:published_time`, JSON-LD `datePublished` or a visible "Published on". */
  publishedAt: string | null
  /** `article:modified_time`, JSON-LD `dateModified` or a visible "Updated on". */
  modifiedAt: string | null
  /** When CiteFox read the page. */
  readAt: string
}

/** The last "Check index" of a page. */
export interface IndexCheck {
  state: IndexState
  /** ISO-8601 UTC. */
  checkedAt: string
  /** Why the check could not tell (`unknown`). Null otherwise. */
  message: string | null
}

/**
 * One logged change (a fix, a rewrite or a new page) on the ledger. Counts are not
 * sent: the renderer counts `before.rows` and `now.rows` with `src/shared/fix-loop.ts`,
 * so each number equals the drill it opens.
 */
export interface ChangeRow {
  fixId: string
  /** The page the fix is stored on: a tracked page, or a topic when `url` is not tracked. */
  pageId: string
  /** The fix number on its page. */
  number: number
  kind: FixKind
  /** Untrusted text: render with the Markdown component. */
  description: string
  /** The page the fix is about: its own address, else its page's. */
  url: string
  /** The page's label, else its title, else null (show the path). */
  title: string | null
  /** ISO-8601 UTC go-live of the change. */
  liveSince: string
  /** Whole days live on the ledger's `builtAt`. Negative before go-live. */
  daysLive: number | null
  pageDates: PageDates | null
  /** Last full check in the page's default market that finished before go-live. */
  before: ChangeCheck | null
  /** Latest full check in that market. Null when the page was never checked. */
  now: ChangeCheck | null
  /** True when `now` started at or after go-live. */
  measuredSinceLive: boolean
  status: ChangeStatus
  index: IndexCheck | null
  /** The newest change on its page (pages count once in the chart and the round). */
  latestOnPage: boolean
  /**
   * The fix's own searches before go-live and now, from whichever page or topic asks
   * them: the verdict (`fixVerdict` in src/shared/fix-verdict.ts) reads only these.
   */
  measure: FixMeasure
}

/** A cached suggested anchor text for a page's backlinks. */
export interface AnchorText {
  pageId: string
  text: string
  /** ISO-8601 UTC. */
  savedAt: string
}

/** The project's measuring rhythm, from its schedule. */
export interface LoopSchedule {
  intervalDays: number
  /** ISO-8601 UTC of the next scheduled check. Null when nothing is scheduled. */
  nextCheckAt: string | null
  /** ISO-8601 UTC of the latest full check of any page. Null before the first. */
  lastCheckAt: string | null
  paused: boolean
}

/** `fixes:ledger`. */
export interface ChangeLedger {
  projectId: string
  /** ISO-8601 UTC the ledger was built ("days live" is counted to this). */
  builtAt: string
  /** The project's own domain, for the drill scope. */
  domain: string
  /** The first brand name, for the drill scope. */
  brand: string
  markets: readonly Market[]
  /**
   * Newest go-live first. Every fix with a page address: one stored on a page, or on
   * a topic with the address it is about (a bare topic has none and is left out).
   */
  rows: readonly ChangeRow[]
  /** "Fix 2 on /blog/x is working: 4 more searches cite it", once per fix, for Activity. */
  workingNotes: readonly string[]
  /** Tracked pages (the Measure step's count). */
  trackedPages: number
  schedule: LoopSchedule
  owners: Readonly<Record<LoopStep, string>>
  anchors: readonly AnchorText[]
}

/** `fixes:setOwner`. 1–{@link OWNER_LABEL_MAX} characters after trimming; empty resets to the default. */
export interface SetLoopOwnerRequest {
  projectId: string
  step: LoopStep
  label: string
}

/** `fixes:setKind`. */
export interface SetFixKindRequest {
  projectId: string
  fixId: string
  kind: FixKind
}

/** `fixes:indexPreview` and `fixes:checkIndex`: pages of this project with an address. */
export interface IndexCheckRequest {
  projectId: string
  pageIds: readonly string[]
}

/**
 * `fixes:indexPreview`. What "Check index" would spend, before anything is sent.
 * `left` is the lower of the project's cap room and the keys' room this month.
 */
export interface IndexCheckPreview {
  pages: number
  searchesMin: number
  searchesMax: number
  /** Searches left this month for this project. Null: no cap and no key limit. */
  left: number | null
  /** False when no key is on, or `searchesMax` would pass `left`. */
  canRun: boolean
  /** Why it cannot run, in plain words. Null when it can. */
  reason: string | null
}

/** `fixes:checkIndex`. The person confirmed `confirmedSearches` (the preview's `searchesMax`). */
export interface RunIndexCheckRequest extends IndexCheckRequest {
  confirmedSearches: number
}

export interface IndexCheckResult {
  pageId: string
  check: IndexCheck
}

export interface IndexCheckRun {
  results: readonly IndexCheckResult[]
  searchesUsed: number
  /** Set when the run stopped early (cap reached, keys out of searches). */
  stoppedReason: string | null
}

/** `fixes:suggestAnchors`. One Claude call per page that has no cached anchor (or all, with `refresh`). */
export interface SuggestAnchorsRequest {
  projectId: string
  pageIds: readonly string[]
  refresh: boolean
}

export interface SuggestAnchorsResult {
  anchors: readonly AnchorText[]
  /** Pages whose call failed, with the reason. */
  failed: readonly { pageId: string; message: string }[]
}

/** `fixes:lostGround`. `vsRunId` null: the full check before the latest one. */
export interface LostGroundRequest {
  projectId: string
  pageId: string
  vsRunId: string | null
}

/** Where each question that cited the page before stands now. */
export type LostBucket = 'still_cited' | 'moved_tracked' | 'moved_own' | 'not_cited'

/** A page read that the outline diff compares. */
export interface PageReadStamp {
  snapshotId: string
  /** ISO-8601 UTC. */
  fetchedAt: string
  title: string | null
}

/** The cached, editable recovery plan for a page and the two checks it compares. */
export interface RecoveryPlan {
  /** Markdown. Untrusted text. */
  text: string
  savedAt: string
  /** True once the person edited it. */
  edited: boolean
  /** `<vsRunId>|<nowRunId>`: a plan for other checks is not shown. */
  inputKey: string
}

export interface LostGroundView {
  pageId: string
  url: string
  title: string | null
  /** The older full check (the "vs" one). */
  before: ChangeCheck
  /** The latest full check. */
  now: ChangeCheck
  /** Every full check of the page in that market, newest first, for the "compare with" picker. */
  checks: readonly { runId: string; checkedAt: string; cited: number }[]
  /** Prompt ids of the questions cited in `before`, by where they stand in `now`. */
  buckets: Readonly<Record<LostBucket, readonly string[]>>
  /** Cited before, not in `now` at all (a newer prompt set). */
  notCheckedNow: readonly string[]
  /** Own URL cited instead, by prompt id, for `moved_tracked` and `moved_own`. */
  movedTo: Readonly<Record<string, string>>
  /** The tracked page each `moved_tracked` URL belongs to, by prompt id. */
  movedToPage: Readonly<Record<string, string>>
  /** The newest change that went live between the two checks. Null when none was logged. */
  change: { fixId: string; kind: FixKind; liveSince: string; description: string } | null
  /** Page read at or before the older check, and the latest page read. */
  beforeRead: PageReadStamp | null
  nowRead: PageReadStamp | null
  /** Null when either read is missing. */
  outline: OutlineDiff | null
  plan: RecoveryPlan | null
}

/** `fixes:saveRecoveryPlan`. */
export interface SaveRecoveryPlanRequest {
  projectId: string
  pageId: string
  inputKey: string
  /** Markdown, 1–8000 characters after trimming. */
  text: string
}

/** `fixes:pageFixCount`: `rollupPageFixes` counted in main, so the badge sends no search list. */
export interface PageFixCount {
  pageFixes: number
  needWork: number
  /** The page fixes with a topic among their sources (the Topics dashboard's count). */
  topicFixes: number
}

/** One line of a page fix brief: a step, an outline section, a fix item. */
export interface PageFixBriefItem {
  id: string
  label?: string
  text: string
  detail?: string | null
}

/** A brief CiteFox AI wrote for a page fix (What to fix), as the drawer shows it. */
export interface PageFixBriefContent {
  title: string
  summary: string | null
  items: readonly PageFixBriefItem[]
  /** What "Log a fix" hands to the fix drawer. */
  text: string
  /** The external writing tool (an https link that sends nothing). Null when none. */
  writeWithUrl: string | null
  /** "CiteFox AI · about 6 s · no searches". */
  note: string
}

/** A saved brief: the page fix's Status reads "Brief ready". */
export interface SavedPageFixBrief {
  /** The page fix's opaque id (`pageFixIdOf`). */
  fixId: string
  brief: PageFixBriefContent
  /** ISO-8601 UTC. */
  savedAt: string
}

/** `fixes:briefs`: every saved page fix brief of the project, newest first. */
export interface PageFixBriefList {
  projectId: string
  briefs: readonly SavedPageFixBrief[]
}

/** `fixes:saveBrief`: keeps the brief just written; a newer one for the fix replaces it. */
export interface SavePageFixBriefRequest {
  projectId: string
  fixId: string
  brief: PageFixBriefContent
}

/** One block of a page in reading order, as the page editor shows it. */
export type PageBlockKind = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'code' | 'table'

export interface PageBlock {
  /** Stable within one result: `b1`, `b2`, … */
  id: string
  kind: PageBlockKind
  /** Plain text; a table is its markdown rows. */
  text: string
}

/**
 * One suggested change to the page. A delete strikes a block out; a replace
 * strikes the old block and adds the new text; an insert adds a block after
 * `after` (null: at the top of the page).
 */
export type PageEditChange =
  | { id: string; op: 'delete'; block: string; why: string }
  | { id: string; op: 'replace'; block: string; kind: PageBlockKind; text: string; why: string }
  | {
      id: string
      op: 'insert'
      after: string | null
      kind: PageBlockKind
      text: string
      why: string
    }

/** `fixes:draftPageEdit`: reads the page (live when not stored) and writes its edits. */
export interface DraftPageEditRequest {
  projectId: string
  fixId: string
  pageId: string | null
  url: string
  /** The searches the page should win, best first (their question text). */
  searches: readonly string[]
  topicId: string | null
  /**
   * What "Why Google picks" found this page needs (owner fixes), as plain lines.
   * Advice for the edits, never page text. Left out when there is none.
   */
  context?: string
}

/** The page with its suggested edits, saved per fix (a newer one replaces it). */
export interface PageEditResult {
  fixId: string
  url: string
  title: string | null
  /** ISO-8601 UTC: when the page text was read. */
  readAt: string
  blocks: readonly PageBlock[]
  changes: readonly PageEditChange[]
  /** One plain line: what the edits do for the buyer. */
  summary: string
  /** "CiteFox AI · about 40 s · no searches". */
  note: string
  /** ISO-8601 UTC. */
  savedAt: string
}

/** `fixes:pageEdit`: the saved edits of one fix. */
export interface PageEditRequest {
  projectId: string
  fixId: string
}

/** `fixes:savePageEditHtml`: the page with its edits as one HTML file, saved where the person picks. */
export interface SavePageEditHtmlRequest {
  projectId: string
  /** Suggested file name, such as `att-email-to-text-alternative-edits.html`. */
  fileName: string
  /** The file's text: HTML, or Markdown when `format` is `md`. */
  html: string
  /** `html` (a styled page) or `md` (Markdown for docs tools and writers). */
  format: 'html' | 'md'
}

/** Saved, or the dialog was cancelled. */
export interface SavePageEditHtmlResult {
  saved: boolean
}

/** Invoke channels for this area. Each one is declared here only. */
export const fixLoopChannels = {
  'fixes:ledger': invokeWith<ProjectIdRequest, ChangeLedger>(),
  'fixes:setOwner': invokeWith<SetLoopOwnerRequest, Readonly<Record<LoopStep, string>>>(),
  'fixes:setKind': invokeWith<SetFixKindRequest, { fixId: string; kind: FixKind }>(),
  'fixes:indexPreview': invokeWith<IndexCheckRequest, IndexCheckPreview>(),
  'fixes:checkIndex': invokeWith<RunIndexCheckRequest, IndexCheckRun>(),
  'fixes:suggestAnchors': invokeWith<SuggestAnchorsRequest, SuggestAnchorsResult>(),
  'fixes:lostGround': invokeWith<LostGroundRequest, LostGroundView>(),
  'fixes:saveRecoveryPlan': invokeWith<SaveRecoveryPlanRequest, RecoveryPlan>(),
  /** Every search of the project's topics and tracked pages, for What to fix (`page-fixes.ts`). */
  'fixes:searches': invokeWith<ProjectIdRequest, ProjectSearches>(),
  /** The sidebar Fixes badge: page fixes to do, and the searches in them. */
  'fixes:pageFixCount': invokeWith<ProjectIdRequest, PageFixCount>(),
  /** Saved page fix briefs (What to fix's "Brief ready" status). */
  'fixes:briefs': invokeWith<ProjectIdRequest, PageFixBriefList>(),
  'fixes:saveBrief': invokeWith<SavePageFixBriefRequest, SavedPageFixBrief>(),
  /** The page with suggested edits (struck out and added), for the drawer's Page edits tab. */
  'fixes:draftPageEdit': invokeWith<DraftPageEditRequest, PageEditResult>(),
  'fixes:pageEdit': invokeWith<PageEditRequest, PageEditResult | null>(),
  'fixes:savePageEditHtml': invokeWith<SavePageEditHtmlRequest, SavePageEditHtmlResult>(),
  /** Why Google cites another page of the site, which page should own the searches, what to change. */
  'fixes:draftOwnerWhy': invokeWith<DraftOwnerWhyRequest, OwnerWhyResult>(),
  'fixes:ownerWhy': invokeWith<OwnerWhyRequest, OwnerWhyResult | null>()
} as const satisfies InvokeChannelSpecs
