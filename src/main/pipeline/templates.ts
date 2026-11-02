import {
  PLAYGROUND_COMPARE_LIMIT,
  SHIPPED_TEMPLATE_NAME,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_NAME_MIN_LENGTH,
  TEMPLATE_NOTES_MAX_LENGTH,
  isRunnableTemplateKind,
  isVariableForKind,
  readTemplateSettings,
  sameTemplateSettings,
  settingsForKind,
  templateKindLifecycle,
  templateStepIndex,
  templateVariablesFor
} from '@shared/domain'
import type {
  GenerationTemplate,
  GenerationTemplateKind,
  TemplateLifecycleTables,
  TemplateSettings,
  TemplateVariableWarning
} from '@shared/domain'
import { TEMPLATE_ERROR_MESSAGES } from '@shared/ipc'
import { parseTemplate, renderTemplateParts, templateNames } from '@shared/template-syntax'
import type {
  CreateTemplateRequest,
  ListTemplatesRequest,
  PlaygroundRunRequest,
  TemplateErrorChannel,
  TemplateErrorCode,
  TemplateUsage,
  TemplateUsageRequest,
  UpdateTemplateRequest,
  UpdateTemplateResult
} from '@shared/ipc'
import { createHash } from 'node:crypto'
import type { SqliteDatabase } from '../storage/database'
import {
  getProject,
  getTemplate,
  insertTemplate,
  listProjects,
  listTemplates,
  swapDefaultTemplate,
  updateTemplate,
  type TemplateRecord
} from '../storage/records'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getCurrentOverride, type TemplateOverrideRecord } from '../storage/template-overrides'
import { StorageError } from '../storage/errors'
import { PipelineError } from './errors'
import { AIO_GAP_TEMPLATE, RUN_SUMMARY_TEMPLATE } from '../engine/checks/report-templates'
import {
  ANSWER_SHAPE_TEMPLATE,
  BUYER_PROFILE_TEMPLATE,
  BUYER_PROMPTS_TEMPLATE,
  COVERAGE_FIXES_TEMPLATE,
  COVERAGE_MATRIX_TEMPLATE,
  COVERAGE_TEMPLATE,
  PAGE_AUDIT_TEMPLATE
} from './template-bodies'
import {
  BRAND_PROMPTS_SCHEMA,
  BRAND_PROMPTS_TEMPLATE,
  SENTIMENT_CLAIMS_SCHEMA,
  SENTIMENT_CLAIMS_TEMPLATE,
  SENTIMENT_CLAIMS_V2_SCHEMA,
  SENTIMENT_CLAIMS_V2_TEMPLATE,
  SENTIMENT_FACT_CHECK_SCHEMA,
  SENTIMENT_FACT_CHECK_TEMPLATE
} from './sentiment-templates'
import { VIDEO_BRIEF_SCHEMA, VIDEO_BRIEF_TEMPLATE } from '../communities/videos/brief'
import { ANSWER_SHAPE_SCHEMA } from '../analytics/answer-shape/schema'
import { TOPIC_SHIPPED_TEMPLATES } from '../topics/templates'
import { ASSISTANT_SHIPPED_TEMPLATES } from '../assistant/templates'

interface ShippedTemplate {
  id: string
  kind: GenerationTemplateKind
  body: string
  /** TPL-3. The output JSON schema stored on the shipped row. Null where the code owns it. */
  schema: Record<string, unknown> | null
}

/**
 * One shipped `CiteFox default` per kind. A kind another area adds ships its body
 * by adding a row here; listing, editing, overrides and resolution need nothing else.
 * The check steps keep the hash of their `.md` body, so past checks still match (TPL-4).
 * Planned kinds (`PLANNED_TEMPLATE_KINDS`) ship a placeholder body here so the row
 * exists; they are hidden and never run until their package writes the body.
 */
export const SHIPPED: readonly ShippedTemplate[] = [
  { id: 'tpl-buyer-profile', kind: 'buyer_profile', body: BUYER_PROFILE_TEMPLATE, schema: null },
  { id: 'tpl-buyer-prompts', kind: 'buyer_prompts', body: BUYER_PROMPTS_TEMPLATE, schema: null },
  {
    id: 'tpl-brand-prompts',
    kind: 'brand_prompts',
    body: BRAND_PROMPTS_TEMPLATE,
    schema: BRAND_PROMPTS_SCHEMA
  },
  { id: 'tpl-coverage', kind: 'coverage', body: COVERAGE_TEMPLATE, schema: null },
  {
    id: 'tpl-coverage-matrix',
    kind: 'coverage_matrix',
    body: COVERAGE_MATRIX_TEMPLATE,
    schema: null
  },
  { id: 'tpl-page-audit', kind: 'page_audit', body: PAGE_AUDIT_TEMPLATE, schema: null },
  { id: 'tpl-coverage-fixes', kind: 'coverage_fixes', body: COVERAGE_FIXES_TEMPLATE, schema: null },
  { id: 'tpl-aio-gap', kind: 'aio_gap', body: AIO_GAP_TEMPLATE.body, schema: null },
  {
    id: 'tpl-answer-shape',
    kind: 'answer_shape',
    body: ANSWER_SHAPE_TEMPLATE,
    schema: ANSWER_SHAPE_SCHEMA
  },
  {
    id: 'tpl-sentiment-claims',
    kind: 'sentiment_claims',
    body: SENTIMENT_CLAIMS_TEMPLATE,
    schema: SENTIMENT_CLAIMS_SCHEMA
  },
  {
    id: 'tpl-sentiment-claims-v2',
    kind: 'sentiment_claims_v2',
    body: SENTIMENT_CLAIMS_V2_TEMPLATE,
    schema: SENTIMENT_CLAIMS_V2_SCHEMA
  },
  {
    id: 'tpl-sentiment-fact-check',
    kind: 'sentiment_fact_check',
    body: SENTIMENT_FACT_CHECK_TEMPLATE,
    schema: SENTIMENT_FACT_CHECK_SCHEMA
  },
  {
    id: VIDEO_BRIEF_TEMPLATE.id,
    kind: 'video_brief',
    body: VIDEO_BRIEF_TEMPLATE.body,
    schema: VIDEO_BRIEF_SCHEMA
  },
  { id: 'tpl-run-summary', kind: 'run_summary', body: RUN_SUMMARY_TEMPLATE.body, schema: null },
  ...TOPIC_SHIPPED_TEMPLATES,
  ...ASSISTANT_SHIPPED_TEMPLATES
]

/** The shipped body for a kind, or null when nothing ships for it. */
export function shippedBody(kind: string): string | null {
  return SHIPPED.find((item) => item.kind === kind)?.body ?? null
}

/**
 * Structured rejection for a template channel.
 * The string form is `${channel}: ${message}` and the message is the fixed sentence.
 */
export class TemplateContractError extends Error {
  readonly channel: TemplateErrorChannel
  readonly code: TemplateErrorCode

  constructor(channel: TemplateErrorChannel, code: TemplateErrorCode) {
    super(`${channel}: ${TEMPLATE_ERROR_MESSAGES[code]}`)
    this.name = 'TemplateContractError'
    this.channel = channel
    this.code = code
  }
}

export function templateHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

/**
 * Unknown names warn and render blank. A syntax error, a tag, or a filter rejects
 * the template. Nothing in the body is evaluated (see `@shared/template-syntax`).
 * `kind` picks which names are known (each step reads its own context blocks).
 */
export function renderTemplate(
  body: string,
  context: Readonly<Record<string, string | number>>,
  kind: string = 'buyer_profile'
): { text: string; warnings: TemplateVariableWarning[] } {
  let parts: ReturnType<typeof parseTemplate>
  try {
    parts = parseTemplate(body)
  } catch {
    throw new PipelineError('The template has a syntax error.', {
      code: 'template',
      nextStep: 'Fix the template syntax and try again.'
    })
  }
  return { text: renderTemplateParts(parts, context), warnings: unknownVariables(body, kind) }
}

/** Names in `body` that `kind`'s step does not fill. They render blank and only warn. */
export function unknownVariables(
  body: string,
  kind: string = 'buyer_profile'
): TemplateVariableWarning[] {
  return templateNames(body)
    .filter((name) => !isVariableForKind(kind, name))
    .map((name) => ({ name, message: `Unknown template variable ${name}.` }))
}

/** Supported names that occur in `body`, in the order the editor lists them. */
export function variablesIn(body: string, kind: string = 'buyer_profile'): string[] {
  const found = new Set(templateNames(body))
  return templateVariablesFor(kind)
    .map((item) => item.name)
    .filter((name) => found.has(name))
}

/** Settings stored on a template row, limited to the ones that apply to its kind. */
export function settingsOfRecord(
  record: Pick<TemplateRecord, 'kind' | 'settingsJson'>
): TemplateSettings {
  let parsed: unknown = null
  if (record.settingsJson !== null) {
    try {
      parsed = JSON.parse(record.settingsJson) as unknown
    } catch {
      parsed = null
    }
  }
  return settingsForKind(record.kind, readTemplateSettings(parsed))
}

/** `settings_json` with these settings merged over any other stored keys. */
function settingsJsonWith(stored: string | null, settings: TemplateSettings): string {
  let base: Record<string, unknown> = {}
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
      base = {}
    }
  }
  return JSON.stringify({ ...base, ...settings })
}

/**
 * Writes or refreshes the shipped rows. A planned kind (Docs/PROMPT-AUDIT.md) has
 * only a placeholder body, so it is not seeded until its package ships it: the
 * template list, the playground and the defaults never see it.
 */
export function seedShippedTemplates(
  db: SqliteDatabase,
  now: () => string = () => new Date().toISOString(),
  tables?: TemplateLifecycleTables
): GenerationTemplate[] {
  return SHIPPED.filter(
    (template) => templateKindLifecycle(template.kind, tables) !== 'planned'
  ).map((template) => seedOne(db, template, now))
}

/**
 * Refuses a kind CiteFox must not send to Claude (Docs/PROMPT-AUDIT.md section 3,
 * rule 6): a planned kind has only a placeholder body, and a retired kind was split
 * into narrower steps, so an old project version of it would fail their schemas.
 */
export function assertRunnableKind(
  kind: GenerationTemplateKind,
  channel: TemplateErrorChannel,
  tables?: TemplateLifecycleTables
): void {
  if (!isRunnableTemplateKind(kind, tables)) {
    throw new TemplateContractError(channel, 'step_unavailable')
  }
}

/**
 * The template a generation uses (FR-26.4, FR-26.8). A `templateId` the user picked
 * wins. Otherwise the project's own current version of the step, when `projectDb`
 * is given and has one, else that kind's app-wide default.
 * A deleted id or a different kind is a typed error, and so is a planned or retired
 * kind ({@link assertRunnableKind}).
 */
export function loadGenerationTemplate(
  db: SqliteDatabase,
  kind: GenerationTemplateKind,
  templateId?: string,
  channel: TemplateErrorChannel = 'buyerProfile:generate',
  projectDb?: SqliteDatabase
): GenerationTemplate {
  assertRunnableKind(kind, channel)
  seedShippedTemplates(db)
  if (templateId === undefined && projectDb !== undefined) {
    const override = getCurrentOverride(projectDb, kind)
    if (override !== null) return overrideAsTemplate(override, kind)
  }
  if (templateId === undefined) return requireDefault(db, kind, channel)
  const template = requireTemplate(db, templateId, channel)
  if (template.deletedAt !== null) throw new TemplateContractError(channel, 'deleted')
  if (template.kind !== kind) throw new TemplateContractError(channel, 'kind_mismatch')
  return template
}

/** Name a project version shows wherever a template name is recorded. */
export function overrideName(version: number): string {
  return `This project's version v${version}`
}

/** A project version in the shape a generation records (id, name, hash, settings). */
export function overrideAsTemplate(
  override: TemplateOverrideRecord,
  kind: GenerationTemplateKind
): GenerationTemplate {
  return {
    id: override.id,
    kind,
    name: overrideName(override.version),
    notes: null,
    body: override.body,
    isShipped: false,
    isDefault: false,
    templateHash: override.hash,
    createdAt: override.createdAt,
    updatedAt: override.createdAt,
    version: override.version,
    deletedAt: null,
    variables: variablesIn(override.body, kind),
    warnings: unknownVariables(override.body, kind),
    settings: settingsForKind(kind, override.settings)
  }
}

export function listGenerationTemplates(
  db: SqliteDatabase,
  request: ListTemplatesRequest
): GenerationTemplate[] {
  seedShippedTemplates(db)
  const includeDeleted = request.includeDeleted === true
  return listTemplates(db)
    .map((record) => toGenerationTemplate(record))
    .filter((template) => request.kind === undefined || template.kind === request.kind)
    .filter((template) => includeDeleted || template.deletedAt === null)
    .sort(compareTemplates)
}

export function getGenerationTemplate(db: SqliteDatabase, id: string): GenerationTemplate | null {
  seedShippedTemplates(db)
  const record = getTemplate(db, id)
  return record === null ? null : toGenerationTemplate(record)
}

export function createGenerationTemplate(
  db: SqliteDatabase,
  request: CreateTemplateRequest,
  options: { id: string; now: string }
): GenerationTemplate {
  seedShippedTemplates(db)
  const channel = 'templates:create'
  const name = trimmedName(request.name, channel)
  const notes = assertNotes(request.notes, channel)
  const body = bodyForCreate(db, request, channel)
  assertRenderable(body, channel)
  if (nameTaken(db, request.kind, name, null)) {
    throw new TemplateContractError(channel, 'name_taken')
  }
  const record: TemplateRecord = {
    id: options.id,
    name,
    version: 1,
    hash: templateHash(body),
    body,
    schema: null,
    settingsJson: null,
    kind: request.kind,
    notes,
    isShipped: false,
    isDefault: false,
    createdAt: options.now,
    updatedAt: null,
    deletedAt: null
  }
  insertTemplate(db, record)
  return toGenerationTemplate(record)
}

export function updateGenerationTemplate(
  db: SqliteDatabase,
  request: UpdateTemplateRequest,
  now: string
): UpdateTemplateResult {
  seedShippedTemplates(db)
  const channel = 'templates:update'
  const stored = requireRecord(db, request.id, channel)
  if (stored.isShipped) throw new TemplateContractError(channel, 'shipped_readonly')
  if (stored.deletedAt !== null) throw new TemplateContractError(channel, 'deleted')
  const name = request.name === undefined ? stored.name : trimmedName(request.name, channel)
  const notes = request.notes === undefined ? stored.notes : assertNotes(request.notes, channel)
  const body = request.body === undefined ? stored.body : request.body
  if (request.body !== undefined) assertRenderable(request.body, channel)
  if (nameTaken(db, stored.kind, name, stored.id)) {
    throw new TemplateContractError(channel, 'name_taken')
  }
  const settings =
    request.settings === undefined
      ? settingsOfRecord(stored)
      : settingsForKind(stored.kind, request.settings)
  const settingsChanged = !sameTemplateSettings(settings, settingsOfRecord(stored))
  const changed =
    name !== stored.name || notes !== stored.notes || body !== stored.body || settingsChanged
  const record: TemplateRecord = {
    ...stored,
    name,
    notes,
    body,
    hash: templateHash(body),
    settingsJson: settingsChanged
      ? settingsJsonWith(stored.settingsJson, settings)
      : stored.settingsJson,
    version: stored.version + 1,
    updatedAt: changed ? now : stored.updatedAt
  }
  updateTemplate(db, record)
  const template = toGenerationTemplate(record)
  return { template, warnings: template.warnings }
}

/**
 * FR-26.5 Reset to default for a user template: the shipped body and settings of
 * its kind become its next version. Saved results keep the hash they were made with.
 */
export function resetTemplateToShipped(
  db: SqliteDatabase,
  id: string,
  now: string
): UpdateTemplateResult {
  seedShippedTemplates(db)
  const channel = 'templates:resetToShipped'
  const stored = requireRecord(db, id, channel)
  if (stored.isShipped) throw new TemplateContractError(channel, 'shipped_readonly')
  if (stored.deletedAt !== null) throw new TemplateContractError(channel, 'deleted')
  const shipped = listTemplates(db).find(
    (record) => record.kind === stored.kind && record.isShipped
  )
  if (shipped === undefined) throw new TemplateContractError(channel, 'not_found')
  const record: TemplateRecord = {
    ...stored,
    body: shipped.body,
    hash: templateHash(shipped.body),
    settingsJson: shipped.settingsJson,
    version: stored.version + 1,
    updatedAt: now
  }
  updateTemplate(db, record)
  const template = toGenerationTemplate(record)
  return { template, warnings: template.warnings }
}

/**
 * Deprecated alias. Returns the template and does not copy a shipped body or move the default.
 */
export function resetGenerationTemplate(db: SqliteDatabase, id: string): GenerationTemplate | null {
  seedShippedTemplates(db)
  return getGenerationTemplate(db, id)
}

export function deleteGenerationTemplate(
  db: SqliteDatabase,
  id: string,
  now: string
): GenerationTemplate {
  seedShippedTemplates(db)
  const channel = 'templates:delete'
  const stored = requireRecord(db, id, channel)
  if (stored.isShipped) throw new TemplateContractError(channel, 'shipped_readonly')
  if (stored.isDefault) throw new TemplateContractError(channel, 'default_in_use')
  if (stored.deletedAt !== null) return toGenerationTemplate(stored)
  const record: TemplateRecord = { ...stored, deletedAt: now }
  updateTemplate(db, record)
  return toGenerationTemplate(record)
}

export function restoreGenerationTemplate(db: SqliteDatabase, id: string): GenerationTemplate {
  seedShippedTemplates(db)
  const channel = 'templates:restore'
  const stored = requireRecord(db, id, channel)
  if (stored.deletedAt === null) return toGenerationTemplate(stored)
  if (nameTaken(db, stored.kind, stored.name, stored.id)) {
    throw new TemplateContractError(channel, 'name_taken')
  }
  const record: TemplateRecord = { ...stored, deletedAt: null }
  updateTemplate(db, record)
  return toGenerationTemplate(record)
}

export function setDefaultGenerationTemplate(db: SqliteDatabase, id: string): GenerationTemplate {
  seedShippedTemplates(db)
  const channel = 'templates:setDefault'
  const current = requireTemplate(db, id, channel)
  if (current.deletedAt !== null) throw new TemplateContractError(channel, 'deleted')
  if (current.isDefault) return current
  swapDefaultTemplate(db, current.kind, current.id)
  const stored = getTemplate(db, current.id)
  if (stored === null) throw new TemplateContractError(channel, 'not_found')
  return toGenerationTemplate(stored)
}

/**
 * Saved buyer profiles, prompt sets, and coverage matrices that still point at this id.
 * Computed here, not on list. Playground runs are not in these tables.
 */
export function readTemplateUsage(
  appDb: SqliteDatabase,
  projectsDirectory: string,
  request: TemplateUsageRequest
): TemplateUsage {
  seedShippedTemplates(appDb)
  requireTemplate(appDb, request.id, 'templates:usage')
  const empty: TemplateUsage = {
    templateId: request.id,
    buyerProfiles: 0,
    promptSets: 0,
    coverageMatrices: 0,
    lastUsedAt: null
  }
  const projects =
    request.projectId === undefined
      ? listProjects(appDb)
      : (() => {
          const project = getProject(appDb, request.projectId)
          return project === null ? [] : [project]
        })()
  if (request.projectId !== undefined && projects.length === 0) return empty
  let buyerProfiles = 0
  let promptSets = 0
  let coverageMatrices = 0
  let lastUsedAt: string | null = null
  for (const project of projects) {
    let db: SqliteDatabase
    try {
      db = openProjectDatabase(projectsDirectory, project.slug)
    } catch (error) {
      if (error instanceof StorageError) continue
      throw error
    }
    try {
      const counted = countSavedArtifacts(db, request.id)
      buyerProfiles += counted.buyerProfiles
      promptSets += counted.promptSets
      coverageMatrices += counted.coverageMatrices
      lastUsedAt = laterTimestamp(lastUsedAt, counted.lastUsedAt)
    } finally {
      closeProjectDatabase(db)
    }
  }
  return { templateId: request.id, buyerProfiles, promptSets, coverageMatrices, lastUsedAt }
}

/** Templates for one playground call, in the requested order. */
export function selectPlaygroundTemplates(
  db: SqliteDatabase,
  request: PlaygroundRunRequest
): GenerationTemplate[] {
  seedShippedTemplates(db)
  const channel = 'playground:run'
  const hasId = request.templateId !== undefined
  // An empty compare list is omitted: fall back to templateId, then the kind default.
  const compareIds =
    request.templateIds !== undefined && request.templateIds.length > 0
      ? [...request.templateIds]
      : undefined
  const hasIds = compareIds !== undefined
  if (hasId && hasIds) throw new TemplateContractError(channel, 'selection_conflict')
  if (!hasId && !hasIds) {
    if (request.kind === undefined) throw new TemplateContractError(channel, 'selection_required')
    assertRunnableKind(request.kind, channel)
    return [requireDefault(db, request.kind, channel)]
  }
  const ids = hasId ? [request.templateId as string] : (compareIds as string[])
  if (!hasId && (ids.length < 1 || ids.length > PLAYGROUND_COMPARE_LIMIT)) {
    throw new TemplateContractError(channel, 'compare_limit')
  }
  const templates = ids.map((id) => requireLive(db, id, channel))
  const kind = templates[0]?.kind
  if (kind === undefined || templates.some((template) => template.kind !== kind)) {
    throw new TemplateContractError(channel, 'kind_mismatch')
  }
  if (request.kind !== undefined && request.kind !== kind) {
    throw new TemplateContractError(channel, 'kind_mismatch')
  }
  assertRunnableKind(kind, channel)
  return templates
}

function seedOne(
  db: SqliteDatabase,
  template: ShippedTemplate,
  now: () => string
): GenerationTemplate {
  const hash = templateHash(template.body)
  const schema = template.schema === null ? null : JSON.stringify(template.schema)
  const existing = getTemplate(db, template.id)
  if (existing === null) {
    const hasDefault = listTemplates(db).some(
      (record) => record.kind === template.kind && record.isDefault && record.deletedAt === null
    )
    const record: TemplateRecord = {
      id: template.id,
      name: SHIPPED_TEMPLATE_NAME,
      version: 1,
      hash,
      body: template.body,
      schema,
      settingsJson: null,
      kind: template.kind,
      notes: null,
      isShipped: true,
      isDefault: !hasDefault,
      createdAt: now(),
      updatedAt: null,
      deletedAt: null
    }
    insertTemplate(db, record)
    return toGenerationTemplate(record)
  }
  const bodyChanged = existing.body !== template.body || existing.hash !== hash
  const nameChanged = existing.name !== SHIPPED_TEMPLATE_NAME
  const shippedFlag = existing.isShipped
  const schemaChanged = schema !== null && existing.schema !== schema
  if (
    !bodyChanged &&
    !nameChanged &&
    !schemaChanged &&
    shippedFlag &&
    existing.deletedAt === null
  ) {
    return toGenerationTemplate(existing)
  }
  // A new shipped body replaces the row in place and is the next version.
  // The default flag stays where the user put it.
  const record: TemplateRecord = {
    ...existing,
    name: SHIPPED_TEMPLATE_NAME,
    version: bodyChanged ? existing.version + 1 : existing.version,
    hash,
    body: template.body,
    schema: schema ?? existing.schema,
    kind: template.kind,
    isShipped: true,
    deletedAt: null,
    updatedAt: bodyChanged || nameChanged ? now() : existing.updatedAt
  }
  updateTemplate(db, record)
  return toGenerationTemplate(record)
}

function bodyForCreate(
  db: SqliteDatabase,
  request: CreateTemplateRequest,
  channel: TemplateErrorChannel
): string {
  const hasBody = request.body !== undefined
  const hasSource = request.fromId !== undefined
  if (hasBody === hasSource) throw new TemplateContractError(channel, 'body_or_source')
  if (request.body !== undefined) return request.body
  const source = requireTemplate(db, request.fromId as string, channel)
  return source.body
}

function requireRecord(
  db: SqliteDatabase,
  id: string,
  channel: TemplateErrorChannel
): TemplateRecord {
  const record = getTemplate(db, id)
  if (record === null) throw new TemplateContractError(channel, 'not_found')
  return record
}

function requireTemplate(
  db: SqliteDatabase,
  id: string,
  channel: TemplateErrorChannel
): GenerationTemplate {
  return toGenerationTemplate(requireRecord(db, id, channel))
}

function requireLive(
  db: SqliteDatabase,
  id: string,
  channel: TemplateErrorChannel
): GenerationTemplate {
  const template = requireTemplate(db, id, channel)
  if (template.deletedAt !== null) throw new TemplateContractError(channel, 'deleted')
  return template
}

export function requireDefault(
  db: SqliteDatabase,
  kind: GenerationTemplateKind,
  channel: TemplateErrorChannel
): GenerationTemplate {
  const match = listTemplates(db).find(
    (record) => record.kind === kind && record.isDefault && record.deletedAt === null
  )
  if (match === undefined) throw new TemplateContractError(channel, 'not_found')
  return toGenerationTemplate(match)
}

export function assertRenderable(body: string, channel: TemplateErrorChannel): void {
  if (body.length === 0) throw new TemplateContractError(channel, 'syntax')
  try {
    renderTemplate(body, {
      url: 'https://example.com',
      title: '',
      meta_description: '',
      h1: '',
      page_text: '',
      brand_name: '',
      prompt_count: 1
    })
  } catch (error) {
    if (error instanceof PipelineError && error.code === 'template') {
      throw new TemplateContractError(channel, 'syntax')
    }
    throw error
  }
}

function trimmedName(name: string, channel: TemplateErrorChannel): string {
  const trimmed = name.trim()
  if (trimmed.length < TEMPLATE_NAME_MIN_LENGTH || trimmed.length > TEMPLATE_NAME_MAX_LENGTH) {
    throw new TemplateContractError(channel, 'name_length')
  }
  return trimmed
}

function assertNotes(
  notes: string | null | undefined,
  channel: TemplateErrorChannel
): string | null {
  if (notes === undefined || notes === null || notes.length === 0) return null
  if (notes.length > TEMPLATE_NOTES_MAX_LENGTH) {
    throw new TemplateContractError(channel, 'notes_length')
  }
  return notes
}

function nameTaken(
  db: SqliteDatabase,
  kind: GenerationTemplateKind,
  name: string,
  exceptId: string | null
): boolean {
  const folded = name.toLowerCase()
  return listTemplates(db).some(
    (record) =>
      record.deletedAt === null &&
      record.kind === kind &&
      record.id !== exceptId &&
      record.name.toLowerCase() === folded
  )
}

export function compareTemplates(left: GenerationTemplate, right: GenerationTemplate): number {
  if (left.isShipped !== right.isShipped) return left.isShipped ? -1 : 1
  if (left.isShipped && right.isShipped) {
    return kindIndex(left.kind) - kindIndex(right.kind) || left.id.localeCompare(right.id)
  }
  const byName = left.name.toLowerCase().localeCompare(right.name.toLowerCase())
  if (byName !== 0) return byName
  const byKind = kindIndex(left.kind) - kindIndex(right.kind)
  if (byKind !== 0) return byKind
  return left.id.localeCompare(right.id)
}

function kindIndex(kind: GenerationTemplateKind): number {
  return templateStepIndex(kind)
}

export function toGenerationTemplate(record: TemplateRecord): GenerationTemplate {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    notes: record.notes,
    body: record.body,
    isShipped: record.isShipped,
    isDefault: record.isDefault,
    templateHash: record.hash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
    deletedAt: record.deletedAt,
    variables: variablesIn(record.body, record.kind),
    warnings: unknownVariables(record.body, record.kind),
    settings: settingsOfRecord(record)
  }
}

interface ArtifactCount {
  buyerProfiles: number
  promptSets: number
  coverageMatrices: number
  lastUsedAt: string | null
}

function countSavedArtifacts(db: SqliteDatabase, templateId: string): ArtifactCount {
  const profiles = timestamps(
    db,
    'SELECT created_at AS at FROM buyer_profiles WHERE template_id = ?',
    templateId
  )
  const prompts = timestamps(
    db,
    'SELECT saved_at AS at FROM prompt_sets WHERE template_id = ?',
    templateId
  )
  const coverage = timestamps(
    db,
    'SELECT recorded_at AS at FROM coverage_runs WHERE template_id = ?',
    templateId
  )
  return {
    buyerProfiles: profiles.length,
    promptSets: prompts.length,
    coverageMatrices: coverage.length,
    lastUsedAt: latestOf([...profiles, ...prompts, ...coverage])
  }
}

function timestamps(db: SqliteDatabase, sql: string, templateId: string): string[] {
  return db
    .prepare<unknown[], { at: string }>(sql)
    .all(templateId)
    .map((row) => row.at)
}

function latestOf(values: readonly string[]): string | null {
  let best: string | null = null
  let bestMs = Number.NEGATIVE_INFINITY
  for (const value of values) {
    const ms = Date.parse(value)
    if (Number.isNaN(ms)) continue
    if (best === null || ms > bestMs) {
      best = value
      bestMs = ms
    }
  }
  return best
}

function laterTimestamp(left: string | null, right: string | null): string | null {
  return latestOf([left, right].filter((value): value is string => value !== null))
}
