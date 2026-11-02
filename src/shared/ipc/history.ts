/** History and notes (FR-15.1 to FR-15.3, FR-7.4). */

import type {
  CheckRunKind,
  CheckRunStatus,
  ContentDiff,
  EngineId,
  Market,
  PageHistory,
  PageNote,
  SearchProvider
} from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/** `history:list`. Null `marketId` is the page's default market (checks only; other events are page-wide). */
export interface HistoryListRequest {
  projectId: string
  pageId: string
  marketId: string | null
}

/** `history:compare`. Two page reads of the same page. */
export interface CompareContentRequest {
  projectId: string
  pageId: string
  fromSnapshotId: string
  toSnapshotId: string
}

/** `history:addNote` (FR-15.3). `date` is a local calendar date, YYYY-MM-DD. */
export interface AddNoteRequest {
  projectId: string
  pageId: string
  date: string
  /** 1–4000 characters after trimming. */
  text: string
}

/** `history:updateNote`. */
export interface UpdateNoteRequest {
  projectId: string
  noteId: string
  date: string
  text: string
}

/** `history:deleteNote`. */
export interface NoteIdRequest {
  projectId: string
  noteId: string
}

export interface DeletedNote {
  noteId: string
}

/** `history:delete` (Check history). One check (run) of the project. */
export interface CheckRunIdRequest {
  projectId: string
  runId: string
}

/** What `history:delete` removed. */
export interface DeletedCheck {
  runId: string
  /** Saved question results (samples) that left with it. */
  samples: number
}

/** A page or topic that has at least one check, as Check history names it. */
export interface HistorySubject {
  id: string
  kind: 'page' | 'topic'
  /** The page's label or title, else its URL; the topic's name. */
  label: string
  /** Null for a topic. */
  url: string | null
}

/**
 * One check (run) of one page or topic in one market, in `history:listProject`.
 * The four counts are prompts scored exactly as Results scores them (section 7.1:
 * the winning sample of each prompt), so a row matches the Results it opens.
 */
export interface ProjectCheck {
  runId: string
  /** The check job that ran it. One job can check several pages and markets. */
  jobId: string
  /** The page or topic (`subjects`). */
  pageId: string
  marketId: string
  /** The page read the check used, for "Compare content" between two checks of a page. */
  snapshotId: string
  kind: CheckRunKind
  /** A follow-up that did not check every enabled question (section 7.4). */
  partial: boolean
  status: CheckRunStatus
  /** ISO-8601 UTC. */
  startedAt: string
  finishedAt: string | null
  /** `finishedAt − startedAt`. Null while it runs. */
  durationMs: number | null
  /** Questions with a saved result in this check. */
  questionsChecked: number
  /** Enabled questions in the check's prompt set. */
  questionsTotal: number
  /** Questions whose AI Overview showed. */
  aiOverviews: number
  /**
   * Questions whose AI Overview cited the page. A topic has no single URL, so for a
   * topic it is any page of the site (Results' "this page" or "other own page").
   */
  cited: number
  /** Questions whose AI Overview named the brand. */
  named: number
  /** SerpApi searches the check's saved results used (an overview's second call included). */
  searchesUsed: number
  /** cloro credits the check's Google samples, brand prompts and engine answers were charged. */
  credits?: number
  /** What the check cost, USD × 1,000,000 at each key's plan. 0 on checks from before costs. */
  costMicros?: number
  /** Who ran the Google search (checks from before cloro: SerpApi). */
  provider?: SearchProvider
  /** The engines the check asked, in display order. */
  engines?: readonly EngineId[]
  /**
   * The visibility score of a finished check, worked out as Results works it out
   * (section 7.2). Null while it runs, when it stopped, or with no AI Overview.
   */
  score: number | null
  /**
   * The score change since the previous full check of the same page, market and
   * prompt set: the page History tab's "Change", from the same rule. Null on a
   * partial check, the first check of a prompt set, or a check with no score.
   */
  scoreChange: number | null
  /** Samples per question (1–5). Re-run cost: questions × samples × 1..2. */
  samples: number
  /** The questions a follow-up asked (its job's list). Null: every enabled question. */
  promptIds: readonly string[] | null
  /**
   * Questions the check meant to ask that have no result, or only errors. Empty
   * while it runs. "Retry failed questions" asks these again.
   */
  failedPromptIds: readonly string[]
}

/** `history:listProject` (Check history). Every check of the project's open pages and topics. */
export interface ProjectHistory {
  projectId: string
  builtAt: string
  /** Every market in the project, default first. */
  markets: readonly Market[]
  /** Pages and topics with at least one check, in the project's page order. */
  subjects: readonly HistorySubject[]
  /** Newest first. Cancelled checks are included and marked. */
  checks: readonly ProjectCheck[]
  /** Pages and topics the project tracks now (setting up, tracked or paused). */
  trackedCount: number
}

/** Invoke channels for this area. Each one is declared here only. */
export const historyChannels = {
  'history:list': invokeWith<HistoryListRequest, PageHistory>(),
  'history:listProject': invokeWith<ProjectIdRequest, ProjectHistory>(),
  'history:compare': invokeWith<CompareContentRequest, ContentDiff>(),
  'history:addNote': invokeWith<AddNoteRequest, PageNote>(),
  'history:updateNote': invokeWith<UpdateNoteRequest, PageNote>(),
  'history:deleteNote': invokeWith<NoteIdRequest, DeletedNote>(),
  'history:delete': invokeWith<CheckRunIdRequest, DeletedCheck>()
} as const satisfies InvokeChannelSpecs
