import { ASSISTANT_SHIPPED_TEMPLATES } from '../assistant/templates'
import {
  GENERATION_TEMPLATE_KINDS,
  RETIRED_STEP_NOTICE,
  compareTemplateKinds,
  isGenerationTemplateKind,
  isListedTemplateStep,
  replacementKinds,
  settingsForKind,
  templateKindLifecycle,
  templateVariablesFor,
  type GenerationTemplate,
  type GenerationTemplateKind,
  type TemplateLifecycleTables,
  type TemplateSettings
} from '@shared/domain'
import type {
  EffectiveTemplate,
  RetiredTemplateStep,
  TemplateOverrideVersion,
  TemplateStep,
  TemplateVersionEntry
} from '@shared/ipc'
import { AIO_GAP_SCHEMA, RUN_SUMMARY_SCHEMA } from '../engine/checks/report-templates'
import type { SqliteDatabase } from '../storage/database'
import { lastCallOfKind } from '../storage/llm-calls'
import { listTemplates, type TemplateRecord } from '../storage/records'
import { listTemplateVersions } from '../storage/template-records'
import {
  getCurrentOverride,
  insertTemplateOverride,
  listOverrideVersions,
  resetTemplateOverrides,
  type TemplateOverrideRecord
} from '../storage/template-overrides'
import { ANSWER_SHAPE_SCHEMA } from '../analytics/answer-shape/schema'
import { VIDEO_BRIEF_SCHEMA } from '../communities/videos/brief'
import {
  BUYER_PROFILE_SCHEMA,
  BUYER_PROMPTS_SCHEMA,
  COVERAGE_FIXES_SCHEMA,
  COVERAGE_MATRIX_SCHEMA,
  COVERAGE_SCHEMA,
  PAGE_AUDIT_SCHEMA
} from './schemas'
import {
  BRAND_PROMPTS_SCHEMA,
  SENTIMENT_CLAIMS_SCHEMA,
  SENTIMENT_CLAIMS_V2_SCHEMA,
  SENTIMENT_FACT_CHECK_SCHEMA
} from './sentiment-templates'
import { TOPIC_SCHEMAS } from '../topics/templates'
import {
  TemplateContractError,
  assertRenderable,
  overrideName,
  requireDefault,
  seedShippedTemplates,
  settingsOfRecord,
  templateHash,
  toGenerationTemplate
} from './templates'

/** Every Ask CiteFox kind answers in the same reply shape. */
const ASSISTANT_SCHEMAS: Readonly<Record<string, Record<string, unknown>>> = Object.fromEntries(
  ASSISTANT_SHIPPED_TEMPLATES.map((template) => [template.kind, template.schema])
)

/**
 * The Templates screen's step list (FR-26.1), project versions (TPL-1, FR-26.8)
 * and version history (FR-26.4). Everything is driven by
 * `GENERATION_TEMPLATE_KINDS`, so a kind another area adds lists here as soon as
 * it ships a body in `SHIPPED`.
 *
 * Planned kinds (`PLANNED_TEMPLATE_KINDS`) are not listed. A retired kind
 * (Docs/PROMPT-AUDIT.md section 3, rule 6) is listed only while the project still has
 * its own version, read-only, with `RETIRED_STEP_NOTICE`.
 */

/**
 * Output schemas per kind (FR-26.2). A kind not listed shows the shipped row's
 * stored `schema` column, or none.
 */
export const TEMPLATE_SCHEMAS: Readonly<Record<string, Record<string, unknown>>> = {
  buyer_profile: BUYER_PROFILE_SCHEMA,
  buyer_prompts: BUYER_PROMPTS_SCHEMA,
  brand_prompts: BRAND_PROMPTS_SCHEMA,
  coverage: COVERAGE_SCHEMA,
  coverage_matrix: COVERAGE_MATRIX_SCHEMA,
  page_audit: PAGE_AUDIT_SCHEMA,
  coverage_fixes: COVERAGE_FIXES_SCHEMA,
  aio_gap: AIO_GAP_SCHEMA,
  answer_shape: ANSWER_SHAPE_SCHEMA,
  sentiment_claims: SENTIMENT_CLAIMS_SCHEMA,
  sentiment_claims_v2: SENTIMENT_CLAIMS_V2_SCHEMA,
  sentiment_fact_check: SENTIMENT_FACT_CHECK_SCHEMA,
  video_brief: VIDEO_BRIEF_SCHEMA,
  run_summary: RUN_SUMMARY_SCHEMA,
  ...TOPIC_SCHEMAS,
  ...ASSISTANT_SCHEMAS
}

export function templateSchemaFor(
  kind: string,
  stored: string | null
): Record<string, unknown> | null {
  const known = TEMPLATE_SCHEMAS[kind]
  if (known !== undefined) return known
  if (stored === null) return null
  try {
    const parsed = JSON.parse(stored) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Every listed step in run order. `projectDb` null lists app templates only. */
export function listTemplateSteps(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase | null,
  tables?: TemplateLifecycleTables
): TemplateStep[] {
  seedShippedTemplates(appDb)
  const records = listTemplates(appDb)
  const kinds = [...GENERATION_TEMPLATE_KINDS].sort(compareTemplateKinds)
  const steps: TemplateStep[] = []
  for (const kind of kinds) {
    const hasVersion = projectDb !== null && getCurrentOverride(projectDb, kind) !== null
    if (!isListedTemplateStep(kind, hasVersion, tables)) continue
    const step = buildStep(projectDb, kind, records, steps.length + 1, tables)
    if (step !== null) steps.push(step)
  }
  return steps
}

export function getTemplateStep(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase | null,
  kind: GenerationTemplateKind,
  tables?: TemplateLifecycleTables
): TemplateStep {
  const step = listTemplateSteps(appDb, projectDb, tables).find((item) => item.kind === kind)
  if (step === undefined) throw new TemplateContractError('templates:steps', 'not_found')
  return step
}

/** The read-only marker of a retired step, or null for a live one. */
export function retiredStep(
  kind: GenerationTemplateKind,
  tables?: TemplateLifecycleTables
): RetiredTemplateStep | null {
  if (templateKindLifecycle(kind, tables) !== 'retired') return null
  return {
    notice: RETIRED_STEP_NOTICE,
    replacedBy: replacementKinds(kind, tables).filter(isGenerationTemplateKind)
  }
}

/** FR-26.4. The next project version of a step. Earlier versions and past results stay. */
export function saveTemplateOverride(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  request: { kind: GenerationTemplateKind; body: string; settings: TemplateSettings },
  options: { id: string; now: string },
  tables?: TemplateLifecycleTables
): TemplateStep {
  seedShippedTemplates(appDb)
  // A retired step's project version stays read-only; a planned step has nothing to edit.
  if (templateKindLifecycle(request.kind, tables) !== 'live') {
    throw new TemplateContractError('templates:saveOverride', 'step_unavailable')
  }
  assertRenderable(request.body, 'templates:saveOverride')
  const current = getCurrentOverride(projectDb, request.kind)
  const base =
    current?.baseTemplateId ?? requireDefault(appDb, request.kind, 'templates:saveOverride').id
  insertTemplateOverride(projectDb, {
    id: options.id,
    kind: request.kind,
    baseTemplateId: base,
    body: request.body,
    hash: templateHash(request.body),
    settings: settingsForKind(request.kind, request.settings),
    createdAt: options.now
  })
  return getTemplateStep(appDb, projectDb, request.kind, tables)
}

/** FR-26.5. The project goes back to the app default. Its versions stay in the file. */
export function resetTemplateOverride(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  kind: GenerationTemplateKind,
  now: string,
  tables?: TemplateLifecycleTables
): TemplateStep {
  // A retired step's project version is kept read-only (rule 6), so it is not reset either.
  if (templateKindLifecycle(kind, tables) !== 'live') {
    throw new TemplateContractError('templates:resetOverride', 'step_unavailable')
  }
  if (getCurrentOverride(projectDb, kind) === null) {
    throw new TemplateContractError('templates:resetOverride', 'no_override')
  }
  resetTemplateOverrides(projectDb, kind, now)
  return getTemplateStep(appDb, projectDb, kind, tables)
}

/** App template versions, or a project's versions of one step. Newest first. */
export function listVersionsOf(
  appDb: SqliteDatabase,
  target: { id: string } | { projectDb: SqliteDatabase; kind: GenerationTemplateKind }
): TemplateVersionEntry[] {
  if ('id' in target) {
    const record = listTemplates(appDb).find((item) => item.id === target.id)
    if (record === undefined) throw new TemplateContractError('templates:versions', 'not_found')
    return listTemplateVersions(appDb, target.id).map((version) => ({
      version: version.version,
      hash: version.hash,
      savedAt: version.savedAt,
      source: 'app',
      current: version.version === record.version
    }))
  }
  const current = getCurrentOverride(target.projectDb, target.kind)
  return listOverrideVersions(target.projectDb, target.kind).map((version) => ({
    version: version.version,
    hash: version.hash,
    savedAt: version.createdAt,
    source: 'project',
    current: current !== null && current.id === version.id
  }))
}

function buildStep(
  projectDb: SqliteDatabase | null,
  kind: GenerationTemplateKind,
  records: readonly TemplateRecord[],
  position: number,
  tables?: TemplateLifecycleTables
): TemplateStep | null {
  const shippedRecord = records.find((record) => record.kind === kind && record.isShipped)
  const defaultRecord = records.find(
    (record) => record.kind === kind && record.isDefault && record.deletedAt === null
  )
  if (shippedRecord === undefined || defaultRecord === undefined) return null
  const shipped = toGenerationTemplate(shippedRecord)
  const appDefault = toGenerationTemplate(defaultRecord)
  const override = projectDb === null ? null : getCurrentOverride(projectDb, kind)
  const status = override !== null ? 'project' : appDefault.isShipped ? 'shipped' : 'edited'
  const schema = templateSchemaFor(kind, shippedRecord.schema)
  return {
    kind,
    position,
    status,
    shipped,
    appDefault,
    override: override === null ? null : overrideView(override, kind),
    effective:
      override === null
        ? effectiveApp(appDefault, defaultRecord)
        : effectiveProject(override, kind),
    schema: schema === null ? null : JSON.stringify(schema, null, 2),
    variables: templateVariablesFor(kind),
    lastRunAt: projectDb === null ? null : lastCallOfKind(projectDb, kind),
    retired: retiredStep(kind, tables)
  }
}

function overrideView(
  override: TemplateOverrideRecord,
  kind: GenerationTemplateKind
): TemplateOverrideVersion {
  return {
    id: override.id,
    kind,
    version: override.version,
    hash: override.hash,
    body: override.body,
    settings: settingsForKind(kind, override.settings),
    baseTemplateId: override.baseTemplateId,
    createdAt: override.createdAt
  }
}

function effectiveApp(template: GenerationTemplate, record: TemplateRecord): EffectiveTemplate {
  return {
    source: 'app',
    id: template.id,
    name: template.name,
    body: template.body,
    hash: template.templateHash,
    version: template.version,
    settings: settingsOfRecord(record)
  }
}

function effectiveProject(
  override: TemplateOverrideRecord,
  kind: GenerationTemplateKind
): EffectiveTemplate {
  return {
    source: 'project',
    id: override.id,
    name: overrideName(override.version),
    body: override.body,
    hash: override.hash,
    version: override.version,
    settings: settingsForKind(kind, override.settings)
  }
}
