import {
  DEFAULT_TEMPLATE_SETTINGS,
  isVariableForKind,
  sameTemplateSettings,
  settingsForKind,
  templateStepIndex,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_NAME_MIN_LENGTH,
  TEMPLATE_NOTES_MAX_LENGTH,
  type GenerationTemplate,
  type GenerationTemplateKind
} from '@shared/domain'
import {
  TEMPLATE_ERROR_MESSAGES,
  isTemplateErrorChannel,
  type CreateTemplateRequest,
  type ListTemplatesRequest,
  type TemplateErrorChannel,
  type TemplateErrorCode,
  type TemplateIdRequest,
  type TemplateUsage,
  type TemplateUsageRequest,
  type TemplateVersionEntry,
  type UpdateTemplateRequest,
  type UpdateTemplateResult
} from '@shared/ipc'
import { getM2Memory, type M2Memory, type StoredTemplate, type StoredUse } from './memory'
import { analyzeTemplate } from '../../templates/syntax'
import { templateNames } from '@shared/template-syntax'
import { sha256Hex } from './sha256'

/**
 * `templates:list`.
 * Shipped templates come first, in kind order. The rest follow by name, then kind, then id.
 */
export async function listTemplates(
  request: ListTemplatesRequest = {}
): Promise<readonly GenerationTemplate[]> {
  const records = getM2Memory()
    .templates.filter((record) => matchesList(record, request))
    .sort(byListOrder)
  return Promise.all(records.map((record) => toGenerationTemplate(record)))
}

export async function getTemplate(request: TemplateIdRequest): Promise<GenerationTemplate> {
  return toGenerationTemplate(requireTemplate(request.id, 'templates:get'))
}

export async function createTemplate(request: CreateTemplateRequest): Promise<GenerationTemplate> {
  const channel = 'templates:create'
  assertName(request.name, channel)
  assertNotes(request.notes, channel)
  const hasBody = request.body !== undefined
  const hasFrom = request.fromId !== undefined
  if (hasBody === hasFrom) throw contractError(channel, 'body_or_source')
  const body = hasBody ? request.body : bodyFrom(request.fromId, channel)
  if (body === undefined) throw contractError(channel, 'body_or_source')
  analyzeTemplate(body, channel)
  if (nameTaken(request.kind, request.name, null)) throw contractError(channel, 'name_taken')
  const memory = getM2Memory()
  const record: StoredTemplate = {
    id: `tpl-${memory.nextTemplate}`,
    kind: request.kind,
    name: request.name,
    body,
    shippedBody: body,
    notes: normalizeNotes(request.notes),
    isShipped: false,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    version: 1,
    deletedAt: null
  }
  memory.nextTemplate += 1
  memory.templates.push(record)
  await recordAppVersion(record)
  return toGenerationTemplate(record)
}

export async function updateTemplate(
  request: UpdateTemplateRequest
): Promise<UpdateTemplateResult> {
  const channel = 'templates:update'
  const record = requireTemplate(request.id, channel, 'not_found')
  if (record.isShipped) throw contractError(channel, 'shipped_readonly')
  if (record.deletedAt !== null) throw contractError(channel, 'deleted')
  if (request.name !== undefined) assertName(request.name, channel)
  const name = request.name ?? record.name
  if (nameTaken(record.kind, name, record.id)) throw contractError(channel, 'name_taken')
  assertNotes(request.notes, channel)
  if (request.body !== undefined) analyzeTemplate(request.body, channel)
  const notes = request.notes === undefined ? record.notes : normalizeNotes(request.notes)
  const body = request.body ?? record.body
  const before = record.settings ?? DEFAULT_TEMPLATE_SETTINGS
  const settings =
    request.settings === undefined ? before : settingsForKind(record.kind, request.settings)
  const changed =
    name !== record.name ||
    notes !== record.notes ||
    body !== record.body ||
    !sameTemplateSettings(settings, before)
  record.name = name
  record.notes = notes
  record.body = body
  record.settings = settings
  if (changed) record.updatedAt = new Date().toISOString()
  record.version += 1
  await recordAppVersion(record)
  const template = await toGenerationTemplate(record)
  return { template, warnings: template.warnings }
}

/**
 * `templates:resetToShipped` (FR-26.5). Copies the shipped body and settings into a
 * user template as its next version. The shipped template itself is read-only.
 */
export async function resetTemplateToShipped(
  request: TemplateIdRequest
): Promise<UpdateTemplateResult> {
  const channel = 'templates:resetToShipped'
  const record = requireTemplate(request.id, channel, 'not_found')
  if (record.isShipped) throw contractError(channel, 'shipped_readonly')
  if (record.deletedAt !== null) throw contractError(channel, 'deleted')
  const shipped = getM2Memory().templates.find(
    (item) => item.kind === record.kind && item.isShipped
  )
  if (!shipped) throw contractError(channel, 'not_found')
  record.body = shipped.body
  record.settings = { ...(shipped.settings ?? DEFAULT_TEMPLATE_SETTINGS) }
  record.updatedAt = new Date().toISOString()
  record.version += 1
  await recordAppVersion(record)
  const template = await toGenerationTemplate(record)
  return { template, warnings: template.warnings }
}

/** `templates:versions` for an app template. Newest first. */
export async function appTemplateVersions(
  request: TemplateIdRequest
): Promise<readonly TemplateVersionEntry[]> {
  const record = requireTemplate(request.id, 'templates:versions', 'not_found')
  const saved = versionsOf().get(record.id) ?? [
    {
      version: record.version,
      hash: await sha256Hex(record.body),
      savedAt: record.updatedAt ?? record.createdAt
    }
  ]
  return [...saved]
    .sort((left, right) => right.version - left.version)
    .map((entry) => ({ ...entry, source: 'app', current: entry.version === record.version }))
}

type SavedVersion = { version: number; hash: string; savedAt: string }

/** Saved versions per app template id. Keyed by the memory, so `resetM2Memory` clears them. */
const appVersions = new WeakMap<M2Memory, Map<string, SavedVersion[]>>()

function versionsOf(): Map<string, SavedVersion[]> {
  const memory = getM2Memory()
  const found = appVersions.get(memory)
  if (found) return found
  const fresh = new Map<string, SavedVersion[]>()
  appVersions.set(memory, fresh)
  return fresh
}

async function recordAppVersion(record: StoredTemplate): Promise<void> {
  const versions = versionsOf()
  const list = versions.get(record.id) ?? []
  list.push({
    version: record.version,
    hash: await sha256Hex(record.body),
    savedAt: record.updatedAt ?? record.createdAt
  })
  versions.set(record.id, list)
}

/**
 * Deprecated alias. Returns the template and does not copy a shipped body or move the default.
 */
export async function resetTemplate(request: TemplateIdRequest): Promise<GenerationTemplate> {
  return toGenerationTemplate(requireTemplate(request.id, 'templates:reset'))
}

export async function deleteTemplate(request: TemplateIdRequest): Promise<GenerationTemplate> {
  const channel = 'templates:delete'
  const record = requireTemplate(request.id, channel, 'not_found')
  if (record.isShipped) throw contractError(channel, 'shipped_readonly')
  if (record.isDefault) throw contractError(channel, 'default_in_use')
  if (record.deletedAt !== null) return toGenerationTemplate(record)
  record.deletedAt = new Date().toISOString()
  record.isDefault = false
  return toGenerationTemplate(record)
}

export async function restoreTemplate(request: TemplateIdRequest): Promise<GenerationTemplate> {
  const channel = 'templates:restore'
  const record = requireTemplate(request.id, channel, 'not_found')
  if (record.deletedAt !== null && nameTaken(record.kind, record.name, record.id)) {
    throw contractError(channel, 'name_taken')
  }
  record.deletedAt = null
  return toGenerationTemplate(record)
}

export async function setDefaultTemplate(request: TemplateIdRequest): Promise<GenerationTemplate> {
  const channel = 'templates:setDefault'
  const record = requireTemplate(request.id, channel, 'not_found')
  if (record.deletedAt !== null) throw contractError(channel, 'deleted')
  for (const item of getM2Memory().templates) {
    if (item.kind === record.kind) item.isDefault = item.id === record.id
  }
  return toGenerationTemplate(record)
}

/** Counts saved artifacts recorded by the generation mock. Playground runs are not included. */
export async function templateUsage(request: TemplateUsageRequest): Promise<TemplateUsage> {
  requireTemplate(request.id, 'templates:usage', 'not_found')
  const uses = getM2Memory().uses.filter(
    (item) =>
      item.templateId === request.id &&
      (request.projectId === undefined || item.projectId === request.projectId)
  )
  return usageFrom(request.id, uses)
}

export function rememberTemplateUse(use: Omit<StoredUse, 'id'>): void {
  const memory = getM2Memory()
  memory.uses.push({ ...use, id: `use-${memory.nextUse}` })
  memory.nextUse += 1
}

/** The template a generate call stores. An omitted id uses the kind's app-wide default. */
export async function applyTemplateChoice(
  kind: GenerationTemplateKind,
  templateId: string | undefined,
  channel: 'buyerProfile:generate' | 'prompts:generate' | 'gaps:generate',
  projectId: string,
  pageId: string,
  bucket: StoredUse['bucket']
): Promise<{
  templateId: string
  templateName: string
  templateHash: string
  templateUpdatedAt: string | null
}> {
  const records = getM2Memory().templates
  const chosen =
    templateId === undefined
      ? records.find((item) => item.kind === kind && item.isDefault && item.deletedAt === null)
      : records.find((item) => item.id === templateId)
  // Content gaps run the coverage matrix step since P1 (Docs/PROMPT-AUDIT.md); the
  // mock's seeded default stays its combined `coverage` template, so a picked
  // matrix template is accepted too.
  const sameStep =
    chosen?.kind === kind || (kind === 'coverage' && chosen?.kind === 'coverage_matrix')
  if (!chosen || chosen.deletedAt !== null || !sameStep) {
    throw new Error(`${channel}: ${TEMPLATE_ERROR_MESSAGES.not_found}`)
  }
  const at = new Date().toISOString()
  rememberTemplateUse({ projectId, pageId, templateId: chosen.id, bucket, at })
  return {
    templateId: chosen.id,
    templateName: chosen.name,
    templateHash: await sha256Hex(chosen.body),
    templateUpdatedAt: chosen.updatedAt
  }
}

function matchesList(record: StoredTemplate, request: ListTemplatesRequest): boolean {
  if (request.kind !== undefined && record.kind !== request.kind) return false
  if (!request.includeDeleted && record.deletedAt !== null) return false
  return true
}

function byListOrder(left: StoredTemplate, right: StoredTemplate): number {
  if (left.isShipped !== right.isShipped) return left.isShipped ? -1 : 1
  if (left.isShipped && right.isShipped) {
    const kind = kindRank(left.kind) - kindRank(right.kind)
    if (kind !== 0) return kind
  } else {
    const name = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
    if (name !== 0) return name
    const kind = kindRank(left.kind) - kindRank(right.kind)
    if (kind !== 0) return kind
  }
  return left.id.localeCompare(right.id)
}

function kindRank(kind: GenerationTemplateKind): number {
  return templateStepIndex(kind)
}

export function requireTemplate(
  id: string,
  channel: string,
  missing: 'invalid' | 'not_found' = 'invalid'
): StoredTemplate {
  const found = getM2Memory().templates.find((template) => template.id === id)
  if (!found) {
    if (missing === 'not_found' && isTemplateErrorChannel(channel)) {
      throw contractError(channel, 'not_found')
    }
    throw new Error(`${channel}: Invalid request`)
  }
  return found
}

function bodyFrom(fromId: string | undefined, channel: TemplateErrorChannel): string {
  if (fromId === undefined) throw contractError(channel, 'body_or_source')
  const source = getM2Memory().templates.find((template) => template.id === fromId)
  if (!source) throw contractError(channel, 'not_found')
  return source.body
}

function nameTaken(kind: GenerationTemplateKind, name: string, exceptId: string | null): boolean {
  const needle = name.toLocaleLowerCase('en')
  return getM2Memory().templates.some(
    (item) =>
      item.deletedAt === null &&
      item.kind === kind &&
      item.id !== exceptId &&
      item.name.toLocaleLowerCase('en') === needle
  )
}

function usageFrom(templateId: string, uses: readonly StoredUse[]): TemplateUsage {
  const buyerProfiles = uses.filter((item) => item.bucket === 'buyerProfiles').length
  const promptSets = uses.filter((item) => item.bucket === 'promptSets').length
  const coverageMatrices = uses.filter((item) => item.bucket === 'coverageMatrices').length
  const stamps = uses.map((item) => item.at).sort()
  return {
    templateId,
    buyerProfiles,
    promptSets,
    coverageMatrices,
    lastUsedAt: stamps.at(-1) ?? null
  }
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes === undefined || notes === null || notes.length === 0) return null
  return notes
}

function assertNotes(notes: string | null | undefined, channel: TemplateErrorChannel): void {
  if (notes !== undefined && notes !== null && notes.length > TEMPLATE_NOTES_MAX_LENGTH) {
    throw contractError(channel, 'notes_length')
  }
}

function isNameLength(value: string): boolean {
  return value.length >= TEMPLATE_NAME_MIN_LENGTH && value.length <= TEMPLATE_NAME_MAX_LENGTH
}

/** Trim is required. An untrimmed name, or a trimmed name outside 1 to 80, is `name_length`. */
function assertName(name: string, channel: TemplateErrorChannel): void {
  const trimmed = name.trim()
  if (name !== trimmed || !isNameLength(trimmed)) throw contractError(channel, 'name_length')
}

export function contractError(channel: TemplateErrorChannel, code: TemplateErrorCode): Error {
  return new Error(`${channel}: ${TEMPLATE_ERROR_MESSAGES[code]}`)
}

export async function toGenerationTemplate(record: StoredTemplate): Promise<GenerationTemplate> {
  const names = templateNames(record.body)
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    notes: record.notes,
    body: record.body,
    isShipped: record.isShipped,
    isDefault: record.isDefault,
    templateHash: await sha256Hex(record.body),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
    deletedAt: record.deletedAt,
    variables: names.filter((name) => isVariableForKind(record.kind, name)),
    warnings: names
      .filter((name) => !isVariableForKind(record.kind, name))
      .map((name) => ({
        name,
        message: `Unknown variable {{ ${name} }}. CiteFox will leave it blank.`
      })),
    settings: record.settings ?? DEFAULT_TEMPLATE_SETTINGS
  }
}
