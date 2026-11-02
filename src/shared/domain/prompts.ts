/** Buyer profiles, buyer prompts, and prompt sets. */

import { isOneOf } from './one-of'

/** FR-3.1. The six parts of a buyer profile. */
const BUYER_PROFILE_PARTS = [
  'who',
  'environment',
  'segments',
  'triggers',
  'values',
  'poor_fit'
] as const

export type BuyerProfilePart = (typeof BUYER_PROFILE_PARTS)[number]

/**
 * FR-3.4 and FR-8.3. `written_by_user` is a prompt the user added
 * before it has one of the other sources.
 */
const PROMPT_SOURCES = [
  'title_meta_h1',
  'trigger_event',
  'objection',
  'detail_check',
  'written_by_user'
] as const

export type PromptSource = (typeof PROMPT_SOURCES)[number]

/** FR-3.4. `unset` is an added prompt the user has not classified yet. */
const INTENT_STAGES = [
  'problem',
  'solution',
  'comparison',
  'objection',
  'trigger',
  'unset'
] as const

export type IntentStage = (typeof INTENT_STAGES)[number]

/** A named item with a reason: a segment, or a poor-fit audience (FR-8.2). */
export interface NamedReason {
  name: string
  reason: string
}

/** The six parts of a buyer profile (FR-3.1, FR-8.2). */
export interface BuyerProfileBody {
  who: string
  /** Tools they already use, and where those people work. Paragraphs may be separated by a newline. */
  environment: string
  segments: readonly NamedReason[]
  triggers: readonly string[]
  values: readonly string[]
  poorFit: readonly NamedReason[]
}

/**
 * Latest buyer profile for a page (section 2.4: one profile covers every market).
 * Section 10 says the latest ICP is used unless pinned. This contract has no pin
 * for a profile, so this is always the latest.
 */
export interface BuyerProfile extends BuyerProfileBody {
  id: string
  pageId: string
  snapshotId: string
  /**
   * Template that generated this profile.
   * The id stays after that template is soft-deleted, so this profile stays readable.
   * Project overrides are a later milestone.
   */
  templateId: string
  /** That template's name at generation. A later rename does not change this. */
  templateName: string
  /** Lowercase SHA-256 hex of the template body that was used. */
  templateHash: string
  /**
   * That template's `updatedAt` at generation.
   * Null when the template had not been changed since it was created.
   */
  templateUpdatedAt: string | null
  /** ISO-8601 UTC (NFR-15). */
  createdAt: string
  /** True when saved prompts were written from an older profile (FR-3.7). */
  promptsStale: boolean
}

/** The wording of one prompt in one market (section 10 `prompt_variants`, FR-8.6). */
export interface PromptVariant {
  marketId: string
  language: string
  text: string
  /**
   * Previous wording after Rephrase. A second Rephrase restores it (FR-3.5).
   * Null when the variant has not been rephrased.
   */
  originalText: string | null
}

/**
 * One buyer prompt (section 10 `prompts`).
 * `enabled` is not a section 10 column. See the IPC ambiguities.
 * False keeps the prompt in the set and leaves it out of the next check.
 */
export interface BuyerPrompt {
  id: string
  position: number
  label: string
  source: PromptSource
  intentStage: IntentStage
  mappedElement: string
  enabled: boolean
  variants: readonly PromptVariant[]
}

/**
 * FR-1.6 and FR-3.8. `minSearches` uses {@link SEARCHES_PER_PROMPT_MIN}.
 * `maxSearches` uses {@link SEARCHES_PER_PROMPT_MAX}.
 * Counts use enabled prompts only.
 */
export interface SearchEstimate {
  prompts: number
  markets: number
  samples: number
  minSearches: number
  maxSearches: number
}

/**
 * The prompt set the Prompts screen shows (FR-3.6, FR-3.8).
 * `prompts` are the draft when `dirty` is true, and the saved set otherwise.
 * `version` stays the last saved version while a draft is open.
 */
export interface PromptSetView {
  pageId: string
  promptSetId: string | null
  version: number | null
  /** ISO-8601 UTC. Null before the first save. */
  savedAt: string | null
  icpId: string | null
  /**
   * Template that generated this set.
   * Null when the set was not generated from a template.
   * When `templateId` is set, `templateName` and `templateHash` are set.
   * The id stays after that template is soft-deleted, so this set stays readable.
   */
  templateId: string | null
  /** That template's name at generation. Null when `templateId` is null. A later rename does not change this. */
  templateName: string | null
  /** Lowercase SHA-256 hex of the template body that was used. Null when `templateId` is null. */
  templateHash: string | null
  /**
   * That template's `updatedAt` at generation.
   * Null when the template had not been changed since it was created, and when `templateId` is null.
   */
  templateUpdatedAt: string | null
  dirty: boolean
  /** The version `prompts:save` will create. Null when nothing is dirty. */
  nextVersion: number | null
  prompts: readonly BuyerPrompt[]
  /** FR-3.3. True when no prompt text contains a brand name or alias. */
  brandsClear: boolean
  /** The sentence the screen shows. It names the brands that were checked. */
  brandMessage: string
  nextCheck: SearchEstimate
}

/**
 * One saved prompt set, without its prompts.
 * `prompts:listSets` returns these, newest `createdAt` first.
 * When the page has a saved set, exactly one of them has `isActive` true.
 */
export interface PromptSetRef {
  id: string
  /** ISO-8601 UTC. The same moment as that set's `savedAt` on `PromptSetView`. */
  createdAt: string
  /**
   * Template that generated this set.
   * Null when the set was not generated from a template.
   * When this is set, `templateName` is set.
   */
  templateId: string | null
  /** That template's name at generation. Null when `templateId` is null. A later rename does not change this. */
  templateName: string | null
  /** Prompts stored in the set, including disabled ones. */
  promptCount: number
  isActive: boolean
}

export function isBuyerProfilePart(value: string): value is BuyerProfilePart {
  return isOneOf(BUYER_PROFILE_PARTS, value)
}

export function isPromptSource(value: string): value is PromptSource {
  return isOneOf(PROMPT_SOURCES, value)
}

export function isIntentStage(value: string): value is IntentStage {
  return isOneOf(INTENT_STAGES, value)
}
