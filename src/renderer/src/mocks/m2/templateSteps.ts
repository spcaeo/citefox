import {
  DEFAULT_TEMPLATE_SETTINGS,
  GENERATION_TEMPLATE_KINDS,
  RETIRED_STEP_NOTICE,
  SHIPPED_TEMPLATE_NAME,
  compareTemplateKinds,
  isGenerationTemplateKind,
  isListedTemplateStep,
  replacementKinds,
  templateKindLifecycle,
  settingsForKind,
  templateKindInfo,
  templateVariablesFor,
  type GenerationTemplateKind,
  type Market,
  type TemplateSettings
} from '@shared/domain'
import {
  TEMPLATE_ERROR_MESSAGES,
  type PageIdRequest,
  type PageList,
  type ProjectIdRequest,
  type SaveTemplateOverrideRequest,
  type TemplateKindRequest,
  type TemplateOverrideVersion,
  type TemplateStep,
  type TemplateStepsRequest,
  type TemplateVersionEntry,
  type TemplateVersionsRequest,
  type TryTemplateRequest,
  type TryTemplateResult
} from '@shared/ipc'
import { TemplateSyntaxError, parseTemplate, renderTemplateParts } from '@shared/template-syntax'
import { textboltCatalog } from './catalog'
import {
  SHIPPED_TEMPLATE_CREATED_AT,
  getM2Memory,
  type M2Memory,
  type StoredTemplate
} from './memory'
import { sha256Hex } from './sha256'
import { STEP_SCHEMAS, TRY_OUTPUTS, TRY_SAMPLE_VALUES } from './templateStepData'
import { appTemplateVersions, contractError, toGenerationTemplate } from './templates'

/**
 * Mock `templates:steps`, `templates:saveOverride`, `templates:resetOverride`,
 * `templates:versions` and `templates:try` for the dev and e2e builds. Project
 * versions live in memory next to the M2 templates, so `resetM2Memory` clears them.
 * Generic over `GENERATION_TEMPLATE_KINDS`: a kind without a shipped body here gets
 * a plain one, so it still lists. Planned kinds are not listed, and a retired kind
 * lists only while the project has its own version, as the engine does.
 */

interface StoredOverride extends TemplateOverrideVersion {
  projectId: string
  resetAt: string | null
}

/** Shipped bodies for the check steps the M2 memory does not seed. */
const EXTRA_SHIPPED: Readonly<Record<string, { id: string; body: string }>> = {
  aio_gap: {
    id: 'aio-gap',
    body: [
      'Template: aio_gap.md',
      'Compare this Google AI Overview with the page snapshot.',
      'List only facts the overview states that the page does not state.',
      'Give the likely source of each fact from the references.',
      '',
      'Page URL: {{ page.url }}',
      'Page title: {{ page.title }}',
      'Market: {{ market.country }} · {{ market.language }}',
      'Prompt: {{ aio.prompt }}',
      'Overview: {{ aio.text }}',
      'References:',
      '{{ aio.references }}',
      'Snapshot:',
      '{{ page.body }}',
      '',
      'Reply with JSON that matches the schema and no other text.'
    ].join('\n')
  },
  answer_shape: {
    id: 'answer-shape',
    body: [
      'Template: answer_shape.md',
      'Classify the blocks of this AI Overview into the fixed answer-shape codes.',
      '',
      'Prompt: {{ prompt_text }}',
      'Overview: {{ overview_text }}',
      '',
      'Reply with JSON that matches the schema and no other text.'
    ].join('\n')
  },
  run_summary: {
    id: 'run-summary',
    body: [
      'Template: run_summary.md',
      'Write a short body for this check.',
      'State the citation change and the content change side by side.',
      'Do not say that a content edit produced a citation change.',
      '',
      'Page URL: {{ page.url }}',
      'Prompts checked: {{ count }}',
      'Page cited: {{ run.page_cited }}',
      'Previous page cited: {{ run.previous_page_cited }}',
      'Content changed: {{ run.content_changed }}',
      'Notes: {{ notes }}',
      '',
      'Reply with JSON that matches the schema and no other text.'
    ].join('\n')
  }
}

const overrides = new WeakMap<M2Memory, StoredOverride[]>()

function overridesOf(): StoredOverride[] {
  const memory = getM2Memory()
  const found = overrides.get(memory)
  if (found) return found
  const fresh: StoredOverride[] = []
  overrides.set(memory, fresh)
  return fresh
}

/** Seeds a shipped default for every kind the M2 memory does not have yet. */
export function ensureStepTemplates(): void {
  const memory = getM2Memory()
  for (const kind of GENERATION_TEMPLATE_KINDS) {
    if (memory.templates.some((item) => item.kind === kind && item.isShipped)) continue
    const extra = EXTRA_SHIPPED[kind] ?? {
      id: kind.replace(/_/g, '-'),
      body: `Template: ${templateKindInfo(kind).file}\n${templateKindInfo(kind).description}\n`
    }
    const hasDefault = memory.templates.some(
      (item) => item.kind === kind && item.isDefault && item.deletedAt === null
    )
    const record: StoredTemplate = {
      id: extra.id,
      kind,
      name: SHIPPED_TEMPLATE_NAME,
      body: extra.body,
      shippedBody: extra.body,
      notes: null,
      isShipped: true,
      isDefault: !hasDefault,
      createdAt: SHIPPED_TEMPLATE_CREATED_AT,
      updatedAt: null,
      version: 1,
      deletedAt: null
    }
    memory.templates.push(record)
  }
}

export async function listTemplateSteps(
  request: TemplateStepsRequest = {}
): Promise<readonly TemplateStep[]> {
  ensureStepTemplates()
  const kinds = [...GENERATION_TEMPLATE_KINDS].sort(compareTemplateKinds)
  const steps: TemplateStep[] = []
  const projectId = request.projectId ?? null
  for (const kind of kinds) {
    const hasVersion = projectId !== null && currentOverride(projectId, kind) !== null
    if (!isListedTemplateStep(kind, hasVersion)) continue
    const step = await buildStep(kind, projectId, steps.length + 1)
    if (step) steps.push(step)
  }
  return steps
}

export async function saveTemplateOverride(
  request: SaveTemplateOverrideRequest
): Promise<TemplateStep> {
  const channel = 'templates:saveOverride'
  ensureStepTemplates()
  if (request.projectId.length === 0) throw contractError(channel, 'project_required')
  if (templateKindLifecycle(request.kind) !== 'live')
    throw contractError(channel, 'step_unavailable')
  assertParses(request.body, channel)
  const list = overridesOf()
  const mine = list.filter(
    (item) => item.projectId === request.projectId && item.kind === request.kind
  )
  const current = currentOverride(request.projectId, request.kind)
  const base = current?.baseTemplateId ?? appDefault(request.kind)?.id ?? request.kind
  const version = mine.reduce((top, item) => Math.max(top, item.version), 0) + 1
  list.push({
    id: `ovr-${request.kind}-${version}-${list.length + 1}`,
    projectId: request.projectId,
    kind: request.kind,
    version,
    hash: await sha256Hex(request.body),
    body: request.body,
    settings: settingsForKind(request.kind, request.settings),
    baseTemplateId: base,
    createdAt: new Date().toISOString(),
    resetAt: null
  })
  return requireStep(request.kind, request.projectId)
}

export async function resetTemplateOverride(request: TemplateKindRequest): Promise<TemplateStep> {
  const channel = 'templates:resetOverride'
  if (templateKindLifecycle(request.kind) !== 'live')
    throw contractError(channel, 'step_unavailable')
  if (currentOverride(request.projectId, request.kind) === null) {
    throw contractError(channel, 'no_override')
  }
  const now = new Date().toISOString()
  for (const item of overridesOf()) {
    if (
      item.projectId === request.projectId &&
      item.kind === request.kind &&
      item.resetAt === null
    ) {
      item.resetAt = now
    }
  }
  return requireStep(request.kind, request.projectId)
}

export async function listTemplateVersions(
  request: TemplateVersionsRequest
): Promise<readonly TemplateVersionEntry[]> {
  if (request.id !== undefined) return appTemplateVersions({ id: request.id })
  if (request.projectId === undefined || request.kind === undefined) {
    throw new Error('templates:versions: Invalid request')
  }
  const { projectId, kind } = request
  const current = currentOverride(projectId, kind)
  return overridesOf()
    .filter((item) => item.projectId === projectId && item.kind === kind)
    .sort((left, right) => right.version - left.version)
    .map((item) => ({
      version: item.version,
      hash: item.hash,
      savedAt: item.createdAt,
      source: 'project' as const,
      current: current !== null && current.id === item.id
    }))
}

/** FR-26.6. Renders the draft with sample page values and returns a canned answer. Saves nothing. */
export async function tryTemplate(request: TryTemplateRequest): Promise<TryTemplateResult> {
  assertParses(request.body, 'templates:try')
  const renderedPrompt = renderTemplateParts(parseTemplate(request.body), TRY_SAMPLE_VALUES)
  const empty = request.body.trim().length === 0
  const output = empty ? 'I need a template to follow.' : (TRY_OUTPUTS[request.kind] ?? '{}')
  const seconds = request.kind === 'coverage' ? 38 : request.kind === 'buyer_prompts' ? 18 : 12
  return {
    renderedPrompt,
    output,
    matched: !empty,
    problem: empty ? 'The answer was not JSON.' : null,
    durationMs: seconds * 1000,
    model: request.settings.model ?? 'claude-sonnet-5-5',
    label: {
      connection: 'claude-code',
      connectionText: 'Claude · on your plan',
      expectedSeconds: 15,
      text: 'Claude · on your plan · about 15 s'
    },
    savedNothing: true
  }
}

/** Try it's pages: the sample catalog's pages for that project, else one sample page. */
export async function listTryPages(request: ProjectIdRequest): Promise<PageList> {
  const project = textboltCatalog().projects.find((item) => item.detail.id === request.projectId)
  if (project) {
    const pages = project.pages
      .filter((item) => item.summary.status !== 'not_tracked')
      .map((item) => ({ ...item.summary }))
    return { foundPageCount: project.pages.length, pages }
  }
  const sample = textboltCatalog().projects[0]?.pages[0]
  if (!sample) return { foundPageCount: 0, pages: [] }
  return {
    foundPageCount: 1,
    pages: [{ ...sample.summary, projectId: request.projectId }]
  }
}

export async function listTryMarkets(request: PageIdRequest): Promise<readonly Market[]> {
  for (const project of textboltCatalog().projects) {
    const page = project.pages.find((item) => item.summary.id === request.pageId)
    if (page) return page.markets.map((item) => ({ ...item }))
  }
  return []
}

async function buildStep(
  kind: GenerationTemplateKind,
  projectId: string | null,
  position: number
): Promise<TemplateStep | null> {
  const records = getM2Memory().templates
  const shippedRecord = records.find((item) => item.kind === kind && item.isShipped)
  const defaultRecord = appDefault(kind)
  if (!shippedRecord || !defaultRecord) return null
  const shipped = await toGenerationTemplate(shippedRecord)
  const appDefaultTemplate = await toGenerationTemplate(defaultRecord)
  const override = projectId === null ? null : currentOverride(projectId, kind)
  const settings: TemplateSettings = defaultRecord.settings ?? DEFAULT_TEMPLATE_SETTINGS
  return {
    kind,
    position,
    status: override !== null ? 'project' : appDefaultTemplate.isShipped ? 'shipped' : 'edited',
    shipped,
    appDefault: appDefaultTemplate,
    override: override === null ? null : overrideView(override),
    effective:
      override === null
        ? {
            source: 'app',
            id: appDefaultTemplate.id,
            name: appDefaultTemplate.name,
            body: appDefaultTemplate.body,
            hash: appDefaultTemplate.templateHash,
            version: appDefaultTemplate.version,
            settings: settingsForKind(kind, settings)
          }
        : {
            source: 'project',
            id: override.id,
            name: `This project's version v${override.version}`,
            body: override.body,
            hash: override.hash,
            version: override.version,
            settings: override.settings
          },
    schema: STEP_SCHEMAS[kind] ?? null,
    variables: templateVariablesFor(kind),
    lastRunAt: projectId === null ? null : lastUseOf(kind, projectId),
    retired:
      templateKindLifecycle(kind) === 'retired'
        ? {
            notice: RETIRED_STEP_NOTICE,
            replacedBy: replacementKinds(kind).filter(isGenerationTemplateKind)
          }
        : null
  }
}

async function requireStep(kind: GenerationTemplateKind, projectId: string): Promise<TemplateStep> {
  const step = (await listTemplateSteps({ projectId })).find((item) => item.kind === kind)
  if (!step) throw contractError('templates:steps', 'not_found')
  return step
}

function appDefault(kind: GenerationTemplateKind): StoredTemplate | undefined {
  return getM2Memory().templates.find(
    (item) => item.kind === kind && item.isDefault && item.deletedAt === null
  )
}

function currentOverride(projectId: string, kind: GenerationTemplateKind): StoredOverride | null {
  const live = overridesOf()
    .filter((item) => item.projectId === projectId && item.kind === kind && item.resetAt === null)
    .sort((left, right) => right.version - left.version)
  return live[0] ?? null
}

function overrideView(override: StoredOverride): TemplateOverrideVersion {
  return {
    id: override.id,
    kind: override.kind,
    version: override.version,
    hash: override.hash,
    body: override.body,
    settings: { ...override.settings },
    baseTemplateId: override.baseTemplateId,
    createdAt: override.createdAt
  }
}

const USE_BUCKET: Readonly<Record<string, string>> = {
  buyer_profile: 'buyerProfiles',
  buyer_prompts: 'promptSets',
  coverage: 'coverageMatrices',
  coverage_matrix: 'coverageMatrices'
}

function lastUseOf(kind: GenerationTemplateKind, projectId: string): string | null {
  const bucket = USE_BUCKET[kind]
  if (bucket === undefined) return null
  const stamps = getM2Memory()
    .uses.filter((item) => item.projectId === projectId && item.bucket === bucket)
    .map((item) => item.at)
    .sort()
  return stamps.at(-1) ?? null
}

function assertParses(body: string, channel: 'templates:saveOverride' | 'templates:try'): void {
  try {
    parseTemplate(body)
  } catch (error) {
    if (error instanceof TemplateSyntaxError) {
      throw new Error(`${channel}: ${TEMPLATE_ERROR_MESSAGES.syntax}`, { cause: error })
    }
    throw error
  }
}
