/** Progress and fixes (FR-14.5 to FR-14.7, SCH-10). */

import type {
  FixKind,
  CoverageAction,
  CoverageLevel,
  CoveragePriority,
  FixList,
  FixPlanPreview,
  FixRecheckRule,
  LoggedFix,
  Market
} from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/** `fixes:list`. */
export interface FixListRequest {
  projectId: string
  pageId: string
}

/**
 * `fixes:preview`. The follow-up dates and search cost for a fix not saved yet.
 * `goLiveAt` is ISO-8601 UTC (the renderer sends local midnight of the picked day).
 */
export interface FixPreviewRequest {
  projectId: string
  pageId: string
  goLiveAt: string
  promptIds: readonly string[]
  marketIds: readonly string[]
}

/**
 * `fixes:create` (FR-14.5). Storage assigns the next number on the page.
 * The follow-up is planned by the scheduler from `rule` (SCH-10).
 */
export interface CreateFixRequest {
  projectId: string
  pageId: string
  /** What changed. 1–4000 characters after trimming. */
  description: string
  /** New page, rewrite or fix. Defaults to `fix`. */
  kind?: FixKind
  goLiveAt: string
  rule: FixRecheckRule
  /** Searches from any page or topic of the project (they are measured where they are asked). */
  promptIds: readonly string[]
  marketIds: readonly string[]
  /** The page address, when `pageId` is a topic or the address is not a tracked page. */
  url?: string
  /** The What to fix page fix it is logged from. */
  pageFixId?: string
}

/**
 * `fixes:update`. Omitted fields stay. Changing the go-live date, rule, prompts or
 * markets re-plans the follow-up (the scheduler reads the stored row). Once the
 * follow-up has started or run, only `description` and `kind` can change: what it
 * checked is history, so a new fix is logged instead.
 */
export interface UpdateFixRequest {
  projectId: string
  fixId: string
  description?: string
  /** New page, rewrite or fix (the Changes ledger). A label: it never re-plans. */
  kind?: FixKind
  goLiveAt?: string
  rule?: FixRecheckRule
  promptIds?: readonly string[]
  marketIds?: readonly string[]
}

/** `fixes:runFollowUp`, `fixes:delete` and `fixes:restore`. */
export interface FixIdRequest {
  projectId: string
  fixId: string
}

/**
 * `fixes:runFollowUp` (FR-14.6). Starts a partial check of the targeted prompts in
 * the fix's markets now. The scheduled follow-up is dropped. `jobId` is the
 * check job, which the Checking screen shows through `checks:listActive`.
 */
export interface RunFollowUpResult {
  fix: LoggedFix
  jobId: string
}

/** A page or topic a fix or a content-gap suggestion is for. */
export interface FixSubject {
  id: string
  kind: 'page' | 'topic'
  /** The page's label or title, else its URL; the topic's name. */
  label: string
  /** Null for a topic. */
  url: string | null
}

/** One logged fix in the project-wide list. */
export interface ProjectFix {
  fix: LoggedFix
  /** Searches "Run follow-up now" uses: prompts × the fix's markets on the page × samples. */
  searchesMin: number
  /** Up to twice that when an overview needs its second call (section 6.1). */
  searchesMax: number
}

/**
 * An open content-gap row (FR-4.5) of a page's latest coverage matrix that is not done:
 * coverage below strong with an action to take. Not a fix until one is logged.
 */
export interface GapSuggestion {
  /** The coverage row id. */
  id: string
  pageId: string
  promptId: string
  /** "Q4" and the question, from the page's active prompt set. Null when no longer in it. */
  promptLabel: string | null
  promptText: string | null
  coverage: CoverageLevel
  priority: CoveragePriority
  actions: readonly CoverageAction[]
  /** What to change. Untrusted text. */
  whatToUpdate: string
  mainGap: string
}

/** `fixes:listProject`. Every fix on every open page and topic, and the open gap suggestions. */
export interface ProjectFixList {
  projectId: string
  /** Every market in the project, to name a fix's markets. */
  markets: readonly Market[]
  /** Pages and topics with a fix or a suggestion, in the project's page order. */
  subjects: readonly FixSubject[]
  /** By page order, then fix number. */
  fixes: readonly ProjectFix[]
  /** High priority first, then by page order. */
  suggestions: readonly GapSuggestion[]
}

/** Invoke channels for this area. Each one is declared here only. */
export const fixesChannels = {
  'fixes:list': invokeWith<FixListRequest, FixList>(),
  'fixes:listProject': invokeWith<ProjectIdRequest, ProjectFixList>(),
  'fixes:preview': invokeWith<FixPreviewRequest, FixPlanPreview>(),
  'fixes:create': invokeWith<CreateFixRequest, LoggedFix>(),
  'fixes:runFollowUp': invokeWith<FixIdRequest, RunFollowUpResult>(),
  'fixes:delete': invokeWith<FixIdRequest, FixList>(),
  'fixes:update': invokeWith<UpdateFixRequest, LoggedFix>(),
  /**
   * Puts back a fix deleted in this app session (the Undo after Delete), with its
   * number, follow-up run and verdict. Refused once the app restarted.
   */
  'fixes:restore': invokeWith<FixIdRequest, LoggedFix>()
} as const satisfies InvokeChannelSpecs
