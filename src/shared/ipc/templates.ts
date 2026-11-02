/** Generation templates. */

import type {
  GenerationTemplate,
  GenerationTemplateKind,
  TemplateSettings,
  TemplateVariableHelp,
  TemplateVariableWarning
} from '../domain'
import type { AssistLabel } from './assist'
import { invokeWith, type InvokeChannelSpecs } from './contract'

export interface TemplateIdRequest {
  id: string
}

/**
 * `templates:list`.
 * Shipped templates come first, in kind order (`buyer_profile`, `buyer_prompts`, `coverage`).
 * The rest follow by name, compared case-insensitively, then by kind, then by id.
 * `includeDeleted` defaults to false. A soft-deleted template is omitted unless it is true.
 */
export interface ListTemplatesRequest {
  /** Omit to return every kind. */
  kind?: GenerationTemplateKind
  /** Omit or false to hide templates with `deletedAt` set. */
  includeDeleted?: boolean
}

/**
 * `templates:create`.
 * Provide `body` or `fromId`, and not both. `fromId` copies that template's body,
 * including a shipped or soft-deleted template. The new template's kind is `kind`,
 * not the source kind. The copy is not shipped and is not the default.
 * An unknown `{{ name }}` is stored on `warnings` and does not reject the call.
 * A Nunjucks syntax or render error rejects it and does not echo the body.
 */
export interface CreateTemplateRequest {
  kind: GenerationTemplateKind
  /**
   * Trimmed before the length check. After trim, 1 to 80 characters.
   * Unique among live templates of `kind`, case-insensitive.
   * Empty or longer than 80 after trim, or still untrimmed, is `name_length`.
   */
  name: string
  body?: string
  /** Omit or null to store null. At most 500 characters. */
  notes?: string | null
  /** Copy this template's body. Mutually exclusive with `body`. */
  fromId?: string
}

/**
 * `templates:update`.
 * Omitted fields stay as they are. `notes: null` clears notes.
 * The row's `schema` and `settingsJson` are copied through unchanged.
 * `version` becomes the previous `version` plus 1.
 * Rejects a shipped template. Rejects a soft-deleted template.
 * An unknown `{{ name }}` comes back as a warning and the save still applies.
 * A Nunjucks syntax or render error rejects the save. The rejection names the channel
 * and does not echo the body.
 */
export interface UpdateTemplateRequest {
  id: string
  /**
   * Omitted leaves the name as it is.
   * Trimmed before the length check. After trim, 1 to 80 characters.
   * Empty or longer than 80 after trim, or still untrimmed, is `name_length`.
   */
  name?: string
  body?: string
  /** Null clears notes. Omit to leave them as they are. */
  notes?: string | null
  /** FR-26.3. Omit to keep the stored settings. Settings that do not apply to the kind are dropped. */
  settings?: TemplateSettings
}

export interface UpdateTemplateResult {
  template: GenerationTemplate
  /** Same list as `template.warnings` after the save. */
  warnings: readonly TemplateVariableWarning[]
}

/**
 * `templates:usage`.
 * Counts saved artifacts only. Playground runs stay in memory and are not counted.
 * Omit `projectId` to count every project. Set it to count one project.
 * The default template is app-wide per kind. `projectId` does not select a project template.
 */
export interface TemplateUsageRequest extends TemplateIdRequest {
  projectId?: string
}

/**
 * How often a template was saved onto a buyer profile, a prompt set, or a coverage matrix.
 * `lastUsedAt` is the latest of those timestamps, or null when every count is 0.
 */
export interface TemplateUsage {
  templateId: string
  buyerProfiles: number
  promptSets: number
  coverageMatrices: number
  /** ISO-8601 UTC. Null when this template has no saved artifact in the requested scope. */
  lastUsedAt: string | null
}

/** What kind of saved artifact used a template. */
export type TemplateUsageItemKind = 'buyer_profile' | 'prompt_set' | 'coverage'

/** One saved artifact behind a `templates:usage` count. */
export interface TemplateUsageItem {
  /** Artifact row id. */
  id: string
  kind: TemplateUsageItemKind
  projectId: string
  projectName: string
  pageId: string
  /** Page label, else title, else URL. */
  pageLabel: string
  pageUrl: string
  /** ISO-8601 UTC. */
  savedAt: string
  /** The wording hash the artifact recorded. */
  templateHash: string
}

/**
 * `templates:usageDetail` (same request as `templates:usage`): every saved artifact
 * behind the counts, newest first. Its per-kind lengths equal the usage counts.
 */
export interface TemplateUsageDetail {
  templateId: string
  items: readonly TemplateUsageItem[]
}

/**
 * Why a template call was rejected.
 * The message is a fixed sentence. It does not include the request, so a body cannot be echoed.
 */
export const TEMPLATE_ERROR_CODES = [
  'shipped_readonly',
  'default_in_use',
  'deleted',
  'not_found',
  'name_taken',
  'name_length',
  'notes_length',
  'body_or_source',
  'kind_mismatch',
  'compare_limit',
  'selection_conflict',
  'selection_required',
  'syntax',
  'project_required',
  'no_override',
  'playground_kind',
  'step_unavailable'
] as const

export type TemplateErrorCode = (typeof TEMPLATE_ERROR_CODES)[number]

/** Fixed sentences for {@link TemplateErrorCode}. The engine does not paraphrase these. */
export const TEMPLATE_ERROR_MESSAGES = {
  shipped_readonly:
    'The shipped CiteFox default template is read-only. Duplicate it to make a copy.',
  default_in_use: 'Set another template as the default before deleting this one.',
  deleted: 'That template is deleted.',
  not_found: 'No template has that id.',
  name_taken: 'A template of this kind already has that name.',
  name_length: 'A template name must be 1 to 80 characters.',
  notes_length: 'Template notes must be 500 characters or fewer.',
  body_or_source: 'Provide a body or a fromId, and not both.',
  kind_mismatch: 'Those templates are not the same kind.',
  compare_limit: 'A playground compare accepts at most 3 templates.',
  selection_conflict: 'Provide templateId or templateIds, not both.',
  selection_required: 'Provide a template, a compare list, or a kind.',
  syntax: 'The template has a syntax error.',
  project_required: 'Open a project first. Project versions belong to one project.',
  no_override: 'This project has no version of that step.',
  playground_kind: 'The playground does not run answer-shape templates.',
  step_unavailable:
    'This step was split into new steps or is not written yet. Open the new steps to edit them.'
} as const satisfies Record<TemplateErrorCode, string>

export const TEMPLATE_ERROR_CHANNELS = [
  'templates:list',
  'templates:get',
  'templates:create',
  'templates:update',
  'templates:delete',
  'templates:restore',
  'templates:setDefault',
  'templates:usage',
  'templates:usageDetail',
  'templates:steps',
  'templates:saveOverride',
  'templates:resetOverride',
  'templates:resetToShipped',
  'templates:versions',
  'templates:try',
  'buyerProfile:generate',
  'prompts:generate',
  'gaps:generate',
  'gaps:redo',
  'playground:run'
] as const

export type TemplateErrorChannel = (typeof TEMPLATE_ERROR_CHANNELS)[number]

export function isTemplateErrorChannel(value: string): value is TemplateErrorChannel {
  return TEMPLATE_ERROR_CHANNELS.some((item) => item === value)
}

/**
 * Structured rejection for a template channel.
 * `message` is the fixed sentence for `code`.
 * The string form on the existing IPC error path is `${channel}: ${message}`.
 */
export type TemplateContractError = {
  [Code in TemplateErrorCode]: {
    channel: TemplateErrorChannel
    code: Code
    message: (typeof TEMPLATE_ERROR_MESSAGES)[Code]
  }
}[TemplateErrorCode]

export function isTemplateErrorCode(value: string): value is TemplateErrorCode {
  return TEMPLATE_ERROR_CODES.some((item) => item === value)
}

/**
 * FR-26.1 status of one step for the open project.
 * `shipped`: the app default is the shipped CiteFox default and there is no project version.
 * `edited`: the app default is a user template. `project`: this project has its own version.
 */
export type TemplateStepStatus = 'shipped' | 'edited' | 'project'

/**
 * One saved version of a project's own template for a step (TPL-1, FR-26.8).
 * Stored in the project database. Versions are never changed; a save adds the next one,
 * and Reset to default marks every version of that step reset.
 */
export interface TemplateOverrideVersion {
  id: string
  kind: GenerationTemplateKind
  version: number
  /** Lowercase SHA-256 hex of `body`. */
  hash: string
  body: string
  settings: TemplateSettings
  /** The app template the first version was copied from. */
  baseTemplateId: string
  /** ISO-8601 UTC. */
  createdAt: string
}

/** What the next run of a step uses (FR-26.4). */
export interface EffectiveTemplate {
  source: 'project' | 'app'
  /** App template id, or the project version id. */
  id: string
  name: string
  body: string
  hash: string
  version: number
  settings: TemplateSettings
}

/** One Claude step in run order, as the Templates screen lists it. */
export interface TemplateStep {
  kind: GenerationTemplateKind
  /** 1-based place in run order. */
  position: number
  status: TemplateStepStatus
  /** The shipped CiteFox default for this kind. */
  shipped: GenerationTemplate
  /** The app-wide default for this kind. The shipped template until a user picks another. */
  appDefault: GenerationTemplate
  /** The open project's current version. Null when there is none or no project is open. */
  override: TemplateOverrideVersion | null
  effective: EffectiveTemplate
  /** FR-26.2. The output fields as pretty JSON schema text. Null when the step has none. */
  schema: string | null
  /** FR-26.2. Variables this step fills, with what each holds. */
  variables: readonly TemplateVariableHelp[]
  /** ISO-8601 UTC of the newest Claude call that used this kind in the project. */
  lastRunAt: string | null
  /**
   * Set on a retired step (Docs/PROMPT-AUDIT.md section 3, rule 6). It lists only while
   * the project has its own version, which stays read-only and never runs. Null otherwise.
   */
  retired: RetiredTemplateStep | null
}

/** Why a step is read-only: it was split into narrower steps. */
export interface RetiredTemplateStep {
  /** The one line the editor shows (`RETIRED_STEP_NOTICE`). */
  notice: string
  /** The steps that replace it, in run order. */
  replacedBy: readonly GenerationTemplateKind[]
}

export interface TemplateStepsRequest {
  /** Omit when no project is open: no step has a project version then. */
  projectId?: string
}

export interface TemplateKindRequest {
  projectId: string
  kind: GenerationTemplateKind
}

/**
 * `templates:saveOverride`. Saves the next project version of a step. The body is
 * checked like any template save. Past prompt sets and checks keep their wording.
 */
export interface SaveTemplateOverrideRequest extends TemplateKindRequest {
  body: string
  settings: TemplateSettings
}

/** `templates:versions`. Name an app template by `id`, or a project's step by `projectId` and `kind`. */
export interface TemplateVersionsRequest {
  id?: string
  projectId?: string
  kind?: GenerationTemplateKind
}

/** One saved version, newest first in a list. */
export interface TemplateVersionEntry {
  version: number
  hash: string
  /** ISO-8601 UTC. */
  savedAt: string
  source: 'project' | 'app'
  /** True for the version a run uses now. */
  current: boolean
}

/**
 * `templates:try` (FR-26.6). Runs a draft once on a real page and market and saves
 * nothing: no generation row, no prompt set, no check. The call is still logged in
 * `llm_calls`. A check step (`aio_gap`, `run_summary`) reads the page's latest
 * finished check in that market.
 */
export interface TryTemplateRequest {
  projectId: string
  pageId: string
  /** Null uses the page's default market. */
  marketId: string | null
  kind: GenerationTemplateKind
  body: string
  settings: TemplateSettings
}

export interface TryTemplateResult {
  renderedPrompt: string
  /** The reply as pretty JSON text, or the raw text when it was not JSON. */
  output: string
  /** True when the reply matched the step's output fields. */
  matched: boolean
  /** Why it did not match, in a sentence. Null when it matched. */
  problem: string | null
  durationMs: number
  model: string | null
  label: AssistLabel
  /** Always true: Try it writes nothing to the page or project. */
  savedNothing: true
}

/** Invoke channels for this area. Each one is declared here only. */
export const templatesChannels = {
  'templates:list': invokeWith<ListTemplatesRequest, readonly GenerationTemplate[]>(),
  'templates:get': invokeWith<TemplateIdRequest, GenerationTemplate>(),
  'templates:create': invokeWith<CreateTemplateRequest, GenerationTemplate>(),
  'templates:update': invokeWith<UpdateTemplateRequest, UpdateTemplateResult>(),
  /**
   * @deprecated Keep for callers that still reset by id.
   * Duplicate the shipped template with `templates:create` and `fromId`.
   * This call does not copy the shipped body onto a user template.
   */
  'templates:reset': invokeWith<TemplateIdRequest, GenerationTemplate>(),
  'templates:delete': invokeWith<TemplateIdRequest, GenerationTemplate>(),
  'templates:restore': invokeWith<TemplateIdRequest, GenerationTemplate>(),
  'templates:setDefault': invokeWith<TemplateIdRequest, GenerationTemplate>(),
  'templates:usage': invokeWith<TemplateUsageRequest, TemplateUsage>(),
  /** The saved artifacts behind `templates:usage`, for its drill-down. */
  'templates:usageDetail': invokeWith<TemplateUsageRequest, TemplateUsageDetail>(),
  /** FR-26.1. Every Claude step in run order with its status for the open project. */
  'templates:steps': invokeWith<TemplateStepsRequest, readonly TemplateStep[]>(),
  /** FR-26.4, FR-26.8. Saves the next project version of a step. */
  'templates:saveOverride': invokeWith<SaveTemplateOverrideRequest, TemplateStep>(),
  /** FR-26.5. The project goes back to the app default for this step. Versions are kept. */
  'templates:resetOverride': invokeWith<TemplateKindRequest, TemplateStep>(),
  /** FR-26.5. Copies the shipped body and settings into a user template as its next version. */
  'templates:resetToShipped': invokeWith<TemplateIdRequest, UpdateTemplateResult>(),
  'templates:versions': invokeWith<TemplateVersionsRequest, readonly TemplateVersionEntry[]>(),
  'templates:try': invokeWith<TryTemplateRequest, TryTemplateResult>()
} as const satisfies InvokeChannelSpecs
