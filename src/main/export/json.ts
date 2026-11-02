import type {
  AioGapFact,
  CheckRunKind,
  CheckRunStatus,
  CitationClass,
  CitationSourceType,
  CompetitorLeaderboardRow,
  ContentChange,
  CoverageLevel,
  CoverageMatrix,
  ExportCheckSet,
  ExportScope,
  ExportSection,
  FunnelStep,
  IntentStage,
  OpportunityBucket,
  PromptCheckStatus,
  PromptMovement,
  PromptSource,
  TopAction
} from '@shared/domain'
import { redactString, redactValue } from '../logging'
import { urlPath } from './model/rows'
import type { ReportModel, ReportPageRole } from './model/types'
import type { PreparedPage, SelectedCheck } from './prepare'
import type { ExportFix, ExportNote, ExportRawSample, ExportSentimentRow } from './types'

/**
 * JSON export (FR-22.2, FR-22.3). The shape is `schema/citefox-export.v2.json`; its
 * `report` object is `schema/citefox-report.v2.json`, the same report model the HTML,
 * PDF, XLSX and CSV outputs render (Docs/REPORT-SPEC.md "Other outputs").
 *
 * Field names are stable within a schema version. A rename or removal bumps
 * `schemaVersion`; a new optional field does not. Records are flat lists joined by id:
 * `runs[].pageId` and `runs[].marketId`, `results[].runId` and `results[].promptId`,
 * `references[].runId` and `references[].promptId`.
 *
 * No secret is written: every string passes the export redaction, and raw SerpApi
 * JSON also drops credential fields such as `api_key` (NFR-5).
 */

export const CITEFOX_EXPORT_SCHEMA_VERSION = 2
export const CITEFOX_EXPORT_FORMAT = 'citefox-export'

/**
 * Version 2 keeps every v1 record list and adds `report` (sections, share of voice,
 * leaderboard authority, universe, sources, reputation, answer shape, deltas) and
 * `pages[].role`.
 */
export interface CitefoxExportV2 {
  schemaVersion: typeof CITEFOX_EXPORT_SCHEMA_VERSION
  format: typeof CITEFOX_EXPORT_FORMAT
  /** ISO-8601 UTC. */
  generatedAt: string
  /** IANA zone the selection's dates use. Stored times stay UTC. */
  timeZone: string
  selection: JsonSelection
  project: JsonProject
  markets: JsonMarket[]
  pages: JsonPage[]
  runs: JsonRun[]
  prompts: JsonPrompt[]
  results: JsonResult[]
  references: JsonReference[]
  /** Empty unless the raw section was chosen. */
  raw: JsonRawSample[]
  report: ReportModel
}

/** @deprecated Version 1 is no longer written; kept as a name for older imports. */
export type CitefoxExportV1 = CitefoxExportV2

export interface JsonSelection {
  scope: ExportScope
  checks: ExportCheckSet
  from: string | null
  to: string | null
  sections: ExportSection[]
  pageIds: string[]
  marketIds: string[]
}

export interface JsonProject {
  name: string
  slug: string
  clientName: string | null
}

export interface JsonMarket {
  id: string
  code: string
}

export interface JsonPage {
  id: string
  /** `tracked`, or `other_own` for an own-domain page cited but not tracked (no checks of its own). */
  role: ReportPageRole
  /** Path and query. */
  path: string
  url: string
  title: string | null
  slug: string
  metaDescription: string | null
  h1: string | null
  snapshotAt: string | null
  promptSetVersion: number | null
  stale: boolean
  /** Empty unless the trends section was chosen. */
  fixes: ExportFix[]
  /** Empty unless the trends section was chosen. */
  notes: ExportNote[]
  /** Empty unless the reputation section was chosen. */
  sentiment: ExportSentimentRow[]
  /** Null unless the content gaps section was chosen and a matrix is stored. */
  gaps: CoverageMatrix | null
}

export interface JsonRunMetrics {
  promptsChecked: number
  promptsWithAio: number
  pageCited: number
  otherOwnPage: number
  brandMentioned: number
  notCited: number
  noAio: number
  errors: number
  points: number
  pointsPossible: number
  visibilityScore: number | null
  citationsThisPage: number
  citationsOtherOwn: number
  citedAndNamed: number
  averagePosition: number | null
}

export interface JsonRun {
  id: string
  pageId: string
  marketId: string
  /** `baseline`, `previous`, `current`, or a calendar date in `timeZone`. */
  label: string
  promptSetId: string
  promptSetVersion: number | null
  snapshotId: string
  contentHash: string
  kind: CheckRunKind
  partial: boolean
  status: CheckRunStatus
  startedAt: string
  finishedAt: string
  contentChanged: boolean
  contentChange: ContentChange | null
  metrics: JsonRunMetrics
  funnel: FunnelStep[]
  buckets: OpportunityBucket[]
  topActions: TopAction[]
  leaderboard: CompetitorLeaderboardRow[]
  cannibalizing: { url: string; tracked: boolean; promptIds: string[] }[]
}

export interface JsonPrompt {
  id: string
  pageId: string
  promptSetId: string
  position: number
  label: string
  source: PromptSource
  intentStage: IntentStage
}

export interface JsonResult {
  runId: string
  pageId: string
  marketId: string
  promptId: string
  /** The prompt as searched in this market. */
  text: string
  status: PromptCheckStatus
  frequency: { matching: number; samples: number }
  position: number | null
  citedUrl: string | null
  wrongPageCited: boolean
  named: boolean | null
  movement: PromptMovement | null
  previousStatus: PromptCheckStatus | null
  previousPosition: number | null
  coverage: CoverageLevel | null
  action: string | null
  checkedAt: string | null
  /** Stored overview text, quoted as stored (FR-22.7). */
  aioText: string | null
  aioGap: AioGapFact[]
}

export interface JsonReference {
  runId: string
  promptId: string
  id: string
  position: number
  url: string
  normalizedUrl: string
  domain: string
  title: string | null
  classification: CitationClass
  untracked: boolean
  sourceType: CitationSourceType
}

export interface JsonRawSample {
  runId: string
  promptId: string
  sampleNo: number
  /** Stored SerpApi search response. A string when the stored text is not JSON. */
  search: unknown
  /** Stored SerpApi AI Overview follow-up response, when one was needed. */
  aio: unknown
}

export interface JsonExportInput {
  projectName: string
  projectSlug: string
  clientName: string | null
  pages: readonly PreparedPage[]
  sections: readonly ExportSection[]
  includeRaw: boolean
  selection: Omit<JsonSelection, 'sections'>
  timeZone: string
  now: Date
  secrets: readonly string[]
  /** The report model for the same scope, markets and checks. */
  model: ReportModel
}

/** Builds the document. Every string is redacted; raw JSON also loses credential fields. */
export function buildJsonExport(input: JsonExportInput): CitefoxExportV2 {
  const want = new Set(input.sections)
  const markets = new Map<string, JsonMarket>()
  const prompts = new Map<string, JsonPrompt>()
  const pages: JsonPage[] = []
  const runs: JsonRun[] = []
  const results: JsonResult[] = []
  const references: JsonReference[] = []
  const raw: JsonRawSample[] = []

  for (const prepared of input.pages) {
    const page = prepared.page
    pages.push({
      id: page.pageId,
      role: 'tracked',
      path: urlPath(page.url),
      url: page.url,
      title: page.title,
      slug: page.slug,
      metaDescription: page.metaDescription,
      h1: page.h1,
      snapshotAt: page.snapshotAt,
      promptSetVersion: page.promptSetVersion,
      stale: page.stale,
      fixes: want.has('trends')
        ? page.fixes.map((fix) => ({
            ...fix,
            promptIds: [...fix.promptIds],
            marketIds: [...fix.marketIds]
          }))
        : [],
      notes: want.has('trends') ? page.notes.map((note) => ({ ...note })) : [],
      sentiment: want.has('reputation') ? sentimentFor(prepared) : [],
      gaps: want.has('content_gaps') ? page.gaps : null
    })
    for (const market of prepared.markets) {
      if (!markets.has(market.marketId)) {
        markets.set(market.marketId, { id: market.marketId, code: market.code })
      }
      for (const selected of market.checks) {
        runs.push(runRecord(selected, page.pageId, market.marketId))
        if (want.has('prompts')) {
          collectPrompts(selected, page.pageId, market.marketId, prompts, results, references)
        }
        if (input.includeRaw) {
          for (const sample of selected.check.raw ?? []) {
            raw.push(rawRecord(sample, selected.check.metrics.runId, input.secrets))
          }
        }
      }
    }
  }

  for (const page of input.model.pages) {
    if (page.role !== 'other_own') continue
    pages.push({
      id: page.id,
      role: 'other_own',
      path: page.path,
      url: page.url,
      title: page.title,
      slug: '',
      metaDescription: null,
      h1: null,
      snapshotAt: null,
      promptSetVersion: null,
      stale: false,
      fixes: [],
      notes: [],
      sentiment: [],
      gaps: null
    })
  }

  const sections = [...input.sections]
  if (input.includeRaw && !sections.includes('raw')) sections.push('raw')
  const document: CitefoxExportV2 = {
    schemaVersion: CITEFOX_EXPORT_SCHEMA_VERSION,
    format: CITEFOX_EXPORT_FORMAT,
    generatedAt: input.now.toISOString(),
    timeZone: input.timeZone,
    selection: { ...input.selection, sections },
    project: {
      name: input.projectName,
      slug: input.projectSlug,
      clientName: input.clientName
    },
    markets: [...markets.values()],
    pages,
    runs,
    prompts: [...prompts.values()],
    results,
    references,
    raw: [],
    report: input.model
  }
  const redacted = redactStrings(document, input.secrets)
  // Raw samples were redacted on their own, with hex-key redaction on.
  return { ...redacted, raw }
}

/** Two-space indented JSON with a trailing newline. */
export function serializeJsonExport(document: CitefoxExportV2): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function sentimentFor(prepared: PreparedPage): ExportSentimentRow[] {
  const markets = new Set(prepared.markets.map((market) => market.marketId))
  return prepared.page.sentiment
    .filter((row) => markets.has(row.marketId))
    .map((row) => ({ ...row }))
}

function runRecord(selected: SelectedCheck, pageId: string, marketId: string): JsonRun {
  const check = selected.check
  const metrics = check.metrics
  return {
    id: metrics.runId,
    pageId,
    marketId,
    label: selected.label,
    promptSetId: metrics.promptSetId,
    promptSetVersion: metrics.promptSetVersion,
    snapshotId: metrics.snapshotId,
    contentHash: metrics.contentHash,
    kind: metrics.kind,
    partial: metrics.partial,
    status: metrics.status,
    startedAt: metrics.startedAt,
    finishedAt: check.finishedAt,
    contentChanged: metrics.contentChanged,
    contentChange: metrics.contentChange,
    metrics: {
      promptsChecked: metrics.promptsChecked,
      promptsWithAio: metrics.promptsWithAio,
      pageCited: metrics.pageCited,
      otherOwnPage: metrics.otherOwnPage,
      brandMentioned: metrics.brandMentioned,
      notCited: metrics.notCited,
      noAio: metrics.noAio,
      errors: metrics.errors,
      points: metrics.points,
      pointsPossible: metrics.pointsPossible,
      visibilityScore: metrics.visibilityScore,
      citationsThisPage: metrics.citationsThisPage,
      citationsOtherOwn: metrics.citationsOtherOwn,
      citedAndNamed: metrics.citedAndNamed,
      averagePosition: metrics.averagePosition
    },
    funnel: check.funnel.map((step) => ({
      id: step.id,
      count: step.count,
      promptIds: [...step.promptIds],
      drop:
        step.drop === null
          ? null
          : {
              count: step.drop.count,
              reason: step.drop.reason,
              promptIds: [...step.drop.promptIds]
            }
    })),
    buckets: check.buckets.map((bucket) => ({
      id: bucket.id,
      count: bucket.count,
      promptIds: [...bucket.promptIds]
    })),
    topActions: check.topActions.map((action) => ({ ...action })),
    leaderboard: check.leaderboard.map((row) => ({
      ...row,
      promptIds: [...row.promptIds],
      gapPromptIds: [...row.gapPromptIds]
    })),
    cannibalizing: check.cannibalizing.map((row) => ({
      url: row.url,
      tracked: row.tracked,
      promptIds: [...row.promptIds]
    }))
  }
}

function collectPrompts(
  selected: SelectedCheck,
  pageId: string,
  marketId: string,
  prompts: Map<string, JsonPrompt>,
  results: JsonResult[],
  references: JsonReference[]
): void {
  const check = selected.check
  const runId = check.metrics.runId
  const promptSetId = check.metrics.promptSetId
  const rows = [...check.prompts].sort((left, right) => left.promptPosition - right.promptPosition)
  for (const row of rows) {
    const key = `${pageId}\u0000${promptSetId}\u0000${row.promptId}`
    if (!prompts.has(key)) {
      prompts.set(key, {
        id: row.promptId,
        pageId,
        promptSetId,
        position: row.promptPosition,
        label: row.label,
        source: row.source,
        intentStage: row.intentStage
      })
    }
    const detail = check.details.find((item) => item.promptId === row.promptId)
    results.push({
      runId,
      pageId,
      marketId,
      promptId: row.promptId,
      text: row.text,
      status: row.status,
      frequency: { matching: row.frequency.matching, samples: row.frequency.samples },
      position: row.position,
      citedUrl: row.citedUrl,
      wrongPageCited: row.wrongPageCited,
      named: row.named,
      movement: row.movement,
      previousStatus: row.previousStatus,
      previousPosition: row.previousPosition,
      coverage: row.coverage,
      action: row.action,
      checkedAt: row.checkedAt,
      aioText: detail?.aioText ?? null,
      aioGap: (detail?.aioGap ?? []).map((fact) => ({ ...fact }))
    })
    for (const reference of detail?.references ?? row.references) {
      references.push({
        runId,
        promptId: row.promptId,
        id: reference.id,
        position: reference.position,
        url: reference.url,
        normalizedUrl: reference.normalizedUrl,
        domain: reference.domain,
        title: reference.title,
        classification: reference.classification,
        untracked: reference.untracked,
        sourceType: reference.sourceType
      })
    }
  }
}

function rawRecord(
  sample: ExportRawSample,
  runId: string,
  secrets: readonly string[]
): JsonRawSample {
  return {
    runId,
    promptId: sample.promptId,
    sampleNo: sample.sampleNo,
    search: rawValue(sample.searchJson, secrets),
    aio: rawValue(sample.aioJson, secrets)
  }
}

/** Parsed stored JSON with credential fields and secret values removed. */
function rawValue(text: string | null, secrets: readonly string[]): unknown {
  if (text === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return redactString(text, { secrets, hexKeys: true })
  }
  return redactValue(parsed, { secrets, hexKeys: true })
}

function redactStrings<T>(value: T, secrets: readonly string[]): T {
  return walk(value, (text) => redactString(text, { secrets, hexKeys: false })) as T
}

function walk(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === 'string') return map(value)
  if (Array.isArray(value)) return value.map((item) => walk(item, map))
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) output[map(key)] = walk(entry, map)
    return output
  }
  return value
}
