/** The coverage matrix (gaps) and saved coverage runs. */

import type { CoverageMatrix, CoverageRunRef, SuggestedFaq } from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { PageIdRequest } from './pages'
import type { PromptIdRequest } from './prompts'

/**
 * `gaps:generate`.
 * `templateId` omitted uses the app-wide default `coverage` template.
 * A soft-deleted id is rejected. Matrices already stored keep their id.
 */
export interface GenerateCoverageRequest extends PageIdRequest {
  templateId?: string
}

export interface SetGapDoneRequest {
  projectId: string
  pageId: string
  promptId: string
  done: boolean
}

/** `coverage:get`. One stored matrix. */
export interface CoverageRunRequest {
  projectId: string
  pageId: string
  runId: string
}

export interface CoverageRunList {
  pageId: string
  runs: readonly CoverageRunRef[]
}

/**
 * Where a content gap stands: `open` until the change is on the page,
 * `published` once it is live (optionally at a section URL), `verified` once a
 * check shows the page cited for that prompt. Published and verified rows are
 * also marked done on the matrix (`gaps:setDone`).
 */
export const GAP_STATUSES = ['open', 'published', 'verified'] as const
export type GapStatus = (typeof GAP_STATUSES)[number]

export function isGapStatus(value: unknown): value is GapStatus {
  return typeof value === 'string' && (GAP_STATUSES as readonly string[]).includes(value)
}

/**
 * What the person changed on one prompt's gap. Keyed by prompt, so it outlives
 * a rewritten matrix. `faq` is their edited draft (null: Claude's draft shows).
 * `status` null means "follow the row's done mark" (open, or published when done).
 */
export interface GapRowState {
  promptId: string
  status: GapStatus | null
  /** The live section, such as https://example.com/pricing#faq. Null when not given. */
  publishedUrl: string | null
  faq: SuggestedFaq | null
  /** ISO-8601 UTC. */
  updatedAt: string
}

/** `gaps:getStates`, and what the gap edits return. */
export interface GapStates {
  pageId: string
  states: readonly GapRowState[]
}

/**
 * `gaps:updateDraft`. Saves the person's FAQ draft for one prompt; Claude's
 * draft on the matrix row is kept, so `reset: true` (question and answer
 * ignored) goes back to it.
 */
export interface UpdateGapDraftRequest {
  projectId: string
  pageId: string
  promptId: string
  question: string
  answer: string
  reset?: boolean
}

/** `gaps:setStatus`. Several prompts at once (bulk). */
export interface SetGapStatusRequest {
  projectId: string
  pageId: string
  promptIds: readonly string[]
  status: GapStatus
  /** Only with `published`; null clears it. Omitted keeps what was stored. */
  publishedUrl?: string | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const coverageChannels = {
  'gaps:get': invokeWith<PageIdRequest, CoverageMatrix | null>(),
  'gaps:generate': invokeWith<GenerateCoverageRequest, CoverageMatrix>(),
  'gaps:setDone': invokeWith<SetGapDoneRequest, CoverageMatrix>(),
  'gaps:redo': invokeWith<PromptIdRequest, CoverageMatrix>(),
  'gaps:getStates': invokeWith<PageIdRequest, GapStates>(),
  'gaps:updateDraft': invokeWith<UpdateGapDraftRequest, GapStates>(),
  'gaps:setStatus': invokeWith<SetGapStatusRequest, GapStates>(),
  'coverage:list': invokeWith<PageIdRequest, CoverageRunList>(),
  'coverage:get': invokeWith<CoverageRunRequest, CoverageMatrix>()
} as const satisfies InvokeChannelSpecs
