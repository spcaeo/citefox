import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Ajv from 'ajv'
import type {
  CheckRunKind,
  CheckRunStatus,
  CitationClass,
  CitationSourceType,
  CoverageAction,
  CoverageFindingKind,
  CoverageLevel,
  CoveragePriority,
  ExportCheckSet,
  ExportScope,
  ExportSection,
  FunnelStepId,
  IntentStage,
  LeaderboardBadge,
  OpportunityBucketId,
  PromptCheckStatus,
  PromptMovement,
  PromptSource,
  TopActionScreen
} from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import {
  fixtureExportSource,
  SAMPLE_MARKET_MX,
  SAMPLE_MARKET_US,
  sampleExportDataset,
  sampleExportRequest
} from './fixture'
import { CITEFOX_EXPORT_SCHEMA_VERSION, type CitefoxExportV2 } from './json'
import { drillIssues } from './model/consistency'
import { richSampleDataset } from './model/sample-dataset.test-helper'
import { reportSchemas } from './schema/report-schema'
import { previewExport, startExport } from './service'
import type { ExportDataset } from './types'

const SCHEMA_PATH = resolve('src/main/export/schema/citefox-export.v2.json')
const SCHEMA_DIR = resolve('src/main/export/schema')
const EXAMPLE_PATH = resolve('examples/textbolt.citefox.json')
const NOW = new Date('2026-10-20T12:00:00.000Z')
const SECRET = 'sk-test-secret-value-1234'
const ALL_SECTIONS: ExportSection[] = [
  'overview',
  'pages',
  'competition',
  'reputation',
  'trends',
  'universe',
  'sources',
  'answer_shape',
  'content_gaps',
  'prompts'
]

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('JSON export', () => {
  test('a full TextBolt export validates against the v2 schema', async () => {
    const document = await exportJson(jsonRequest())
    expect(validate(document)).toEqual([])
    expect(document.schemaVersion).toBe(CITEFOX_EXPORT_SCHEMA_VERSION)
    expect(document.format).toBe('citefox-export')
    expect(document.generatedAt).toBe(NOW.toISOString())
    expect(document.project).toEqual({
      name: 'TextBolt',
      slug: 'textbolt',
      clientName: 'Northwind'
    })
    expect(document.markets.map((market) => market.code)).toEqual(['us-en', 'mx-es'])
    expect(document.runs.map((run) => run.id)).toEqual([
      'run-baseline',
      'run-previous',
      'run-current',
      'run-mx'
    ])
    expect(document.runs.map((run) => run.label)).toEqual([
      '2026-09-21',
      '2026-10-05',
      '2026-10-19',
      '2026-10-19'
    ])
    expect(document.prompts.length).toBeGreaterThan(0)
    expect(document.results.filter((row) => row.runId === 'run-current')).toHaveLength(
      document.prompts.length
    )
    const joined = new Set(document.results.map((row) => `${row.runId}/${row.promptId}`))
    for (const reference of document.references) {
      expect(joined.has(`${reference.runId}/${reference.promptId}`)).toBe(true)
    }
    expect(document.pages[0]?.gaps?.rows.length).toBeGreaterThan(0)
    expect(document.pages[0]?.fixes).toHaveLength(1)
    expect(document.pages[0]?.sentiment).toHaveLength(1)
    expect(document.pages[0]?.role).toBe('tracked')
    expect(document.raw).toEqual([])
    expect(document.report.version).toBe(2)
    expect(document.report.overview.tracked.n).toBe(document.report.rows.length)
    expect(drillIssues(document.report)).toEqual([])
  })

  test('the v2 report object carries every REPORT-SPEC section and validates', async () => {
    const { document } = await exportJsonText(
      jsonRequest({
        projectId: 'proj-textbolt',
        scope: 'page',
        pageIds: ['page-alerts'],
        marketIds: ['mkt-us', 'mkt-ca']
      }),
      richSampleDataset(),
      []
    )
    expect(validate(document)).toEqual([])
    const report = document.report
    expect(report.competition.sov.total.n).toBe(report.overview.aio.n)
    expect(report.competition.leaderboard[0]).toHaveProperty('authority')
    expect(report.universe.dimensions.length).toBeGreaterThan(2)
    expect(report.sources.platforms.length).toBeGreaterThan(2)
    expect(report.sources.youtube.videos.length).toBe(1)
    expect(report.sources.reddit.threads.length).toBe(1)
    expect(report.answerShape.journeys.length).toBeGreaterThan(0)
    expect(report.trends.gained.count.n).toBeGreaterThan(0)
    expect(report.contentGaps.matrix).toHaveLength(10)
    expect(report.reputation.empty).not.toBeNull()
    expect(
      document.pages.filter((page) => page.role === 'other_own').map((page) => page.path)
    ).toEqual(['/blog/email-to-sms/', '/login'])
    expect(drillIssues(report)).toEqual([])
  })

  test('the citefox-report*.v2.json files are the report schema builder', () => {
    // CITEFOX_WRITE_SCHEMA=1 rewrites the files. Run prettier on them afterwards.
    for (const [file, schema] of Object.entries(reportSchemas())) {
      const path = join(SCHEMA_DIR, file)
      if (process.env.CITEFOX_WRITE_SCHEMA === '1')
        writeFileSync(path, `${JSON.stringify(schema)}\n`)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(schema)
    }
  })

  test('the schema rejects unknown fields, wrong enums, and a missing version', async () => {
    const document = await exportJson(jsonRequest())
    const run = document.runs[0]
    expect(run).toBeDefined()
    if (run === undefined) return
    expect(validate({ ...document, apiKey: 'x' })).not.toEqual([])
    expect(validate({ ...document, schemaVersion: 1 })).not.toEqual([])
    expect(
      validate({ ...document, report: { ...document.report, overview: { headline: 'x' } } })
    ).not.toEqual([])
    expect(validate({ ...document, runs: [{ ...run, status: 'done' }] })).not.toEqual([])
    const { raw, ...withoutRaw } = document
    expect(raw).toEqual([])
    expect(validate(withoutRaw)).not.toEqual([])
  })

  test('sections that were not chosen are empty, not missing', async () => {
    const document = await exportJson(jsonRequest({ sections: ['overview'] }))
    expect(validate(document)).toEqual([])
    expect(document.runs.length).toBeGreaterThan(0)
    expect(document.prompts).toEqual([])
    expect(document.results).toEqual([])
    expect(document.references).toEqual([])
    expect(document.pages[0]).toMatchObject({ fixes: [], notes: [], sentiment: [], gaps: null })
  })

  test('secrets are removed from stored text and from raw SerpApi JSON', async () => {
    const dataset = sampleExportDataset()
    const withSecrets: ExportDataset = {
      ...dataset,
      projectName: `TextBolt ${SECRET}`,
      pages: dataset.pages.map((page) => ({
        ...page,
        markets: page.markets.map((market) => ({
          ...market,
          checks: market.checks.map((check) => ({
            ...check,
            details: check.details.map((detail) => ({
              ...detail,
              aioText: `${detail.aioText ?? ''} ${SECRET}`
            })),
            raw: [
              {
                promptId: 'prompt-1',
                sampleNo: 1,
                searchJson: JSON.stringify({
                  search_parameters: { q: 'text alerts', api_key: 'raw-key-marker' },
                  search_metadata: {
                    json_endpoint: 'https://serpapi.com/search.json?api_key=raw-url-marker&q=x'
                  },
                  note: `echo ${SECRET}`
                }),
                aioJson: 'not json raw-text-marker'
              }
            ]
          }))
        }))
      }))
    }
    const { document, text } = await exportJsonText(
      jsonRequest({ sections: [...ALL_SECTIONS, 'raw'] }),
      withSecrets,
      [SECRET, 'raw-text-marker']
    )
    expect(validate(document)).toEqual([])
    for (const marker of [SECRET, 'raw-key-marker', 'raw-url-marker', 'raw-text-marker']) {
      expect(text).not.toContain(marker)
    }
    expect(document.raw.length).toBeGreaterThan(0)
    expect(document.raw[0]).toMatchObject({ runId: 'run-baseline', promptId: 'prompt-1' })
    expect(document.selection.sections).toContain('raw')
    expect(text).toContain('[REDACTED]')
  })

  test('raw SerpApi data is allowed only for JSON', async () => {
    const preview = await previewExport({
      request: sampleExportRequest({ sections: ['overview', 'raw'] }),
      source: fixtureExportSource(sampleExportDataset()),
      now: () => NOW
    })
    expect(preview.blocked).toBe(true)
    expect(preview.reason).toBe('Raw search data is only included in JSON exports.')
    expect(preview.nextStep).toBe('Remove the raw section, or choose JSON.')
    const json = await previewExport({
      request: jsonRequest({ sections: ['raw'] }),
      source: fixtureExportSource(sampleExportDataset()),
      now: () => NOW
    })
    expect(json.blocked).toBe(false)
  })

  test('the preview shows the start of the file', async () => {
    const preview = await previewExport({
      request: jsonRequest(),
      source: fixtureExportSource(sampleExportDataset()),
      now: () => NOW
    })
    expect(preview.blocked).toBe(false)
    expect(preview.preview.startsWith('{\n  "schemaVersion": 2,')).toBe(true)
    expect(preview.estimatedBytes).toBeGreaterThan(0)
  })

  test('schema enums match the shared domain types', () => {
    const definitions = schemaDefinitions()
    const enumOf = (name: string): unknown => definitions[name]?.enum
    expect(enumOf('promptCheckStatus')).toEqual(keys<PromptCheckStatus>(PROMPT_CHECK_STATUSES))
    expect(enumOf('promptMovement')).toEqual(keys<PromptMovement>(PROMPT_MOVEMENTS))
    expect(enumOf('citationClass')).toEqual(keys<CitationClass>(CITATION_CLASSES))
    expect(enumOf('citationSourceType')).toEqual(keys<CitationSourceType>(SOURCE_TYPES))
    expect(enumOf('checkRunKind')).toEqual(keys<CheckRunKind>(RUN_KINDS))
    expect(enumOf('checkRunStatus')).toEqual(keys<CheckRunStatus>(RUN_STATUSES))
    expect(enumOf('promptSource')).toEqual(keys<PromptSource>(PROMPT_SOURCES))
    expect(enumOf('intentStage')).toEqual(keys<IntentStage>(INTENT_STAGES))
    expect(enumOf('coverageLevel')).toEqual(keys<CoverageLevel>(COVERAGE_LEVELS))
    expect(enumOf('coverageAction')).toEqual(keys<CoverageAction>(COVERAGE_ACTIONS))
    expect(enumOf('coveragePriority')).toEqual(keys<CoveragePriority>(COVERAGE_PRIORITIES))
    expect(enumOf('coverageFindingKind')).toEqual(keys<CoverageFindingKind>(FINDING_KINDS))
    expect(enumOf('funnelStepId')).toEqual(keys<FunnelStepId>(FUNNEL_STEPS))
    expect(enumOf('opportunityBucketId')).toEqual(keys<OpportunityBucketId>(BUCKETS))
    expect(enumOf('topActionScreen')).toEqual(keys<TopActionScreen>(SCREENS))
    expect(enumOf('leaderboardBadge')).toEqual(keys<LeaderboardBadge>(BADGES))
    const selection = schemaSelection()
    expect(selection.scope?.enum).toEqual(keys<ExportScope>(SCOPES))
    expect(selection.checks?.enum).toEqual(keys<ExportCheckSet>(CHECK_SETS))
    expect(selection.sections?.items?.enum).toEqual(keys<ExportSection>(SECTIONS))
  })

  test('examples/textbolt.citefox.json is the TextBolt sample exported as JSON v2', async () => {
    // CITEFOX_WRITE_EXAMPLES=1 rewrites the file. Run prettier on it afterwards.
    const { document, text } = await exportJsonText(exampleRequest(), richSampleDataset(), [])
    if (process.env.CITEFOX_WRITE_EXAMPLES === '1') writeFileSync(EXAMPLE_PATH, text)
    const example = readFileSync(EXAMPLE_PATH, 'utf8')
    expect(JSON.parse(example)).toEqual(document)
    expect(validate(JSON.parse(example))).toEqual([])
    expect(example).not.toMatch(/api_key|sk-ant-|password|secret/i)
  })
})

/** The request `examples/textbolt.citefox.json` is written with. */
function exampleRequest(): ExportRequest {
  return jsonRequest({
    projectId: 'proj-textbolt',
    scope: 'project',
    pageIds: [],
    marketIds: ['mkt-us', 'mkt-ca'],
    filenamePattern: 'textbolt.citefox.{ext}'
  })
}

function jsonRequest(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return sampleExportRequest({
    format: 'json',
    csv: null,
    checks: 'all',
    marketIds: [SAMPLE_MARKET_US, SAMPLE_MARKET_MX],
    sections: ALL_SECTIONS,
    ...overrides
  })
}

async function exportJson(request: ExportRequest): Promise<CitefoxExportV2> {
  return (await exportJsonText(request, sampleExportDataset(), [])).document
}

async function exportJsonText(
  request: ExportRequest,
  dataset: ExportDataset,
  secrets: readonly string[]
): Promise<{ document: CitefoxExportV2; text: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-json-export-'))
  directories.push(directory)
  const result = await startExport({
    request,
    source: fixtureExportSource(dataset),
    directory,
    secrets,
    now: () => NOW,
    createId: () => 'export-json'
  })
  expect(result).toMatchObject({ ok: true, format: 'json' })
  if (!result.ok) throw new Error(result.reason)
  expect(result.filename.endsWith('.json')).toBe(true)
  const text = readFileSync(result.filePath, 'utf8')
  expect(result.bytes).toBe(Buffer.byteLength(text))
  return { document: JSON.parse(text) as CitefoxExportV2, text }
}

interface SchemaNode {
  enum?: unknown
  items?: SchemaNode
  properties?: Record<string, SchemaNode>
}

function loadSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>
}

function schemaDefinitions(): Record<string, SchemaNode> {
  return loadSchema().definitions as Record<string, SchemaNode>
}

function schemaSelection(): Record<string, SchemaNode> {
  const properties = loadSchema().properties as Record<string, SchemaNode>
  return properties.selection?.properties ?? {}
}

function validate(document: unknown): string[] {
  const ajv = new Ajv({ allErrors: true, strict: true })
  for (const file of Object.keys(reportSchemas())) {
    ajv.addSchema(
      JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')) as Record<string, unknown>
    )
  }
  const check = ajv.compile(loadSchema())
  if (check(document)) return []
  return (check.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`)
}

/** Keys in declaration order. `satisfies` makes the compiler check every member is listed. */
function keys<T extends string>(record: Record<T, true>): T[] {
  return Object.keys(record) as T[]
}

const PROMPT_CHECK_STATUSES = {
  page_cited: true,
  other_own_page: true,
  brand_mentioned: true,
  not_cited: true,
  no_aio: true,
  error: true
} satisfies Record<PromptCheckStatus, true>
const PROMPT_MOVEMENTS = {
  gained: true,
  lost: true,
  improved: true,
  declined: true,
  unchanged: true
} satisfies Record<PromptMovement, true>
const CITATION_CLASSES = {
  target: true,
  own: true,
  competitor: true,
  other: true
} satisfies Record<CitationClass, true>
const SOURCE_TYPES = {
  web: true,
  reddit: true,
  youtube: true,
  linkedin: true,
  review: true,
  forum: true,
  other: true
} satisfies Record<CitationSourceType, true>
const RUN_KINDS = {
  baseline: true,
  scheduled: true,
  manual: true,
  follow_up: true
} satisfies Record<CheckRunKind, true>
const RUN_STATUSES = {
  running: true,
  finished: true,
  cancelled: true,
  error: true
} satisfies Record<CheckRunStatus, true>
const PROMPT_SOURCES = {
  title_meta_h1: true,
  trigger_event: true,
  objection: true,
  detail_check: true,
  written_by_user: true
} satisfies Record<PromptSource, true>
const INTENT_STAGES = {
  problem: true,
  solution: true,
  comparison: true,
  objection: true,
  trigger: true,
  unset: true
} satisfies Record<IntentStage, true>
const COVERAGE_LEVELS = {
  strong: true,
  partial: true,
  weak: true,
  none: true
} satisfies Record<CoverageLevel, true>
const COVERAGE_ACTIONS = {
  update_existing: true,
  new_faq: true,
  small_update: true,
  optional_faq: true,
  none: true
} satisfies Record<CoverageAction, true>
const COVERAGE_PRIORITIES = { high: true, medium: true, low: true } satisfies Record<
  CoveragePriority,
  true
>
const FINDING_KINDS = {
  factual_claim: true,
  missing_promised_section: true,
  typo: true,
  title_length: true,
  title_meta_mismatch: true,
  other: true
} satisfies Record<CoverageFindingKind, true>
const FUNNEL_STEPS = {
  checked: true,
  aio_shown: true,
  own_domain: true,
  this_page: true,
  cited_and_named: true
} satisfies Record<FunnelStepId, true>
const BUCKETS = {
  winning: true,
  cited_only: true,
  named_not_linked: true,
  invisible: true
} satisfies Record<OpportunityBucketId, true>
const SCREENS = { gaps: true, communities: true, page_read: true } satisfies Record<
  TopActionScreen,
  true
>
const BADGES = { you: true, tracked: true, observed: true } satisfies Record<LeaderboardBadge, true>
const SCOPES = { page: true, selected: true, project: true, view: true } satisfies Record<
  ExportScope,
  true
>
const CHECK_SETS = { latest: true, trio: true, all: true, range: true } satisfies Record<
  ExportCheckSet,
  true
>
const SECTIONS = {
  overview: true,
  topic_coverage: true,
  pages: true,
  competition: true,
  reputation: true,
  trends: true,
  universe: true,
  sources: true,
  answer_shape: true,
  content_gaps: true,
  prompts: true,
  raw: true
} satisfies Record<ExportSection, true>
