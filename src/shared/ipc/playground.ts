/** The template playground. */

import type { GenerationTemplateKind, KeyTestReason, TemplateVariableWarning } from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { MarketDraft } from './projects'

/**
 * Optional replacements for one playground run.
 * Null fields mean "use the saved template, the template's prompt count, or the project's brand".
 * A playground URL is not a project page, so `brandName` has no project to read when the run is not saved.
 */
export interface PlaygroundOverrides {
  body: string | null
  promptCount: number | null
  brandName: string | null
}

/**
 * `playground:run`. `url` is any page, not a project page id.
 * Pass `templateId` for one template, or a non-empty `templateIds` to compare up to
 * `PLAYGROUND_COMPARE_LIMIT` (3) templates of the same kind. Not both.
 * An empty `templateIds` array is the same as omitting it. It is not an error, and it
 * does not conflict with `templateId`. The engine then uses `templateId`, then the
 * kind's current app-wide default. `kind` is required only when both id fields are
 * absent. `templates:reset` is a deprecated alias and does not copy the shipped
 * body onto a user template. Copy the shipped template with `templates:create` instead.
 * A Nunjucks syntax or render error rejects the run. Unknown variable names
 * come back on `warnings` and do not reject it.
 * `overrides` apply to every template in the call.
 */
export interface PlaygroundRunRequest {
  url: string
  /**
   * One template. Omit when using `templateIds`, or when `kind` selects the default.
   */
  templateId?: string
  /**
   * Same URL against 1 to `PLAYGROUND_COMPARE_LIMIT` (3) templates of one kind.
   * Alternative to `templateId`.
   * `[]` is the same as omitting this field. It is not an error.
   */
  templateIds?: readonly string[]
  /**
   * Which kind's app-wide default to run when no id is set.
   * When ids are set, omit this or set the same kind those templates have.
   */
  kind?: GenerationTemplateKind
  overrides: PlaygroundOverrides | null
}

/**
 * Usage for one playground model call.
 * Counts only. There is no cost field.
 * `serpapiSearches` is 0 when the run did not call SerpApi.
 */
export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  serpapiSearches: number
}

/**
 * One ephemeral playground run.
 * Unsaved runs stay in memory until the app quits. The engine keeps the most recent
 * `PLAYGROUND_MEMORY_RUNS` (20) and drops the oldest beyond that.
 * `playground:saveToProject` is what writes a run into a project, and only the parts named on that call.
 */
export interface PlaygroundRunResult {
  runId: string
  url: string
  templateId: string
  /** That template's name at run time. A later rename does not change this. */
  templateName: string
  /**
   * Lowercase SHA-256 hex of the body that was rendered, including an override.
   * This is the template body that was used, not the page body.
   * It can differ from the template's saved `templateHash` when `overrides.body` is set.
   */
  templateHash: string
  /**
   * The saved template's `updatedAt`.
   * Null when that template had not been changed since it was created.
   * An override does not change this. The hash records the body that was rendered.
   */
  templateUpdatedAt: string | null
  /** Template body after `{{ variables }}` are filled. */
  renderedPrompt: string
  /** Text the model returned. Not parsed. */
  modelOutput: string
  /** Model that actually ran. */
  resolvedModel: string
  usage: ModelUsage
  durationMs: number
  warnings: readonly TemplateVariableWarning[]
}

/**
 * Live SerpApi AI Overview check for one or more prompt strings.
 * `market` null means the app default market. If that default is unset, each prompt
 * comes back `ok: false` and no country is invented.
 * `runId` null is a one-off check. A non-null id attaches the check to that ephemeral run
 * so `playground:saveToProject` can keep it.
 */
export interface PlaygroundAioRequest {
  url: string
  prompts: readonly string[]
  market: MarketDraft | null
  runId: string | null
}

/** One source cited in an AI Overview. */
export interface AioCitedSource {
  url: string
  domain: string
  /** 1-based place among the cited sources. */
  position: number
}

/**
 * One prompt's AI Overview capture.
 * `keyId` and `keyLabel` name the SerpApi key that was used. They are null when no key was chosen.
 * The secret is never returned.
 * `reason` and `message` are set when `ok` is false. `reason` uses the same codes as `KeyTestResult`.
 * `message` must not contain a secret.
 */
export interface PlaygroundAioPromptResult {
  prompt: string
  ok: boolean
  keyId: string | null
  /** The key's display name. Not a hint and not a secret. */
  keyLabel: string | null
  reason: KeyTestReason | null
  message: string | null
  /** Null when `ok` is false. */
  cited: boolean | null
  /** Empty when `ok` is false. */
  citedSources: readonly AioCitedSource[]
  /**
   * 1-based place of the requested page URL among the cited sources.
   * Null when that URL was not cited, or when `ok` is false.
   */
  position: number | null
  /** Short text of the AI Overview. Not the raw response body. */
  summary: string | null
}

export interface PlaygroundAioResult {
  url: string
  runId: string | null
  prompts: readonly PlaygroundAioPromptResult[]
}

/** Pieces of an ephemeral playground run that `playground:saveToProject` may write. */
export const PLAYGROUND_SAVE_PARTS = [
  'pageRead',
  'buyerProfile',
  'prompts',
  'coverage',
  'aioChecks'
] as const

export type PlaygroundSavePart = (typeof PLAYGROUND_SAVE_PARTS)[number]

export function isPlaygroundSavePart(value: string): value is PlaygroundSavePart {
  return PLAYGROUND_SAVE_PARTS.some((item) => item === value)
}

export interface SavePlaygroundRunRequest {
  runId: string
  projectId: string
  /**
   * Which pieces to write. At least one.
   * A listed part the run does not contain writes nothing for that part and does not fail the save.
   * Anything not listed stays ephemeral.
   */
  parts: readonly [PlaygroundSavePart, ...PlaygroundSavePart[]]
}

/** The project page the ephemeral run was saved onto. `parts` is what was written. */
export interface SavePlaygroundRunResult {
  projectId: string
  pageId: string
  runId: string
  parts: readonly PlaygroundSavePart[]
}

/** Invoke channels for this area. Each one is declared here only. */
export const playgroundChannels = {
  'playground:run': invokeWith<PlaygroundRunRequest, readonly PlaygroundRunResult[]>(),
  'playground:checkAio': invokeWith<PlaygroundAioRequest, PlaygroundAioResult>(),
  'playground:saveToProject': invokeWith<SavePlaygroundRunRequest, SavePlaygroundRunResult>()
} as const satisfies InvokeChannelSpecs
