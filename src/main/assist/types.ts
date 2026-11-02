import type { AssistItem, AssistRunRequest } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import type { SqliteDatabase } from '../storage/database'
import type { ProjectRecord } from '../storage/records'

/**
 * One assist (FR-25). Every assist shares the reply schema (`ASSIST_REPLY_SCHEMA`)
 * and the output rules (`preamble.ts`); a definition is its task, how it gathers
 * saved data, and its limits. Register more with `registerAssist`.
 */
export interface AssistDefinition {
  id: string
  /** Button and result heading, such as "Shorter title". */
  title: string
  /** Shipped estimate in seconds, used until `llm_calls` has history. */
  expectedSeconds: number
  /** FR-25.3. */
  acceptsInstruction: boolean
  /** True when the assist reads a project (and the request must name one). */
  needsProject: boolean
  /** Request fields that must be set, beyond `projectId`. */
  needs?: readonly ('pageId' | 'marketId' | 'promptId')[]
  /** The shipped task text. */
  task: string
  /** Items the reply must hold. Defaults to 0 and 12. */
  minItems?: number
  maxItems?: number
  /** True when every item must carry `sign` (line proposals). */
  signedItems?: boolean
  /**
   * Saved data for the prompt, as readable text. Throw `AssistInputError` when
   * something the assist needs is missing. Never spends a SerpApi search.
   */
  gather(context: AssistContext): string | Promise<string>
  /** Optional extra check on the validated reply. Return a sentence to reject it. */
  check?(reply: AssistReply, context: AssistContext): string | null
  /**
   * Web search and web fetch for this call (Docs/PROMPT-AUDIT.md rule 8). Only for an
   * opt-in step whose answer is not in saved data; `gather` must then return short
   * derived lines only, never page text or secrets.
   */
  webSearch?: boolean
  /**
   * An answer built from saved data with no Claude call (a current coverage matrix, a
   * stored audit), or null to ask Claude. Skipped when the user typed an instruction.
   */
  answerFromSaved?(context: AssistContext): AssistReply | null
  /** Items code computes from saved data, listed after Claude's (lengths, stored findings). */
  savedItems?(context: AssistContext): readonly Omit<AssistItem, 'id'>[]
  /**
   * Code's last pass over Claude's checked answer: a length it measures, or saving the
   * answer where a screen reads it (the page's promise summary).
   */
  finish?(reply: AssistReply, context: AssistContext): AssistReply
}

export interface AssistContext {
  host: EngineHost
  request: AssistRunRequest
  /** Open for the call when `needsProject`; closed afterwards. */
  project: ProjectRecord | null
  db: SqliteDatabase | null
}

/** The validated reply, before ids are assigned. */
export interface AssistReply {
  summary: string | null
  items: readonly Omit<AssistItem, 'id'>[]
  caution: string | null
}

/** A missing page, market, or saved result. The message tells the user what to do. */
export class AssistInputError extends Error {
  readonly nextStep: string | null

  constructor(message: string, nextStep: string | null = null) {
    super(message)
    this.name = 'AssistInputError'
    this.nextStep = nextStep
  }
}
