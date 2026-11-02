import type { ExportPreview, ExportSection } from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import { fileExtension } from './export/formats'

/*
 * Mock-up numbers for the in-memory export engine (`engine.ts`). Unit tests and
 * the e2e mock build use it. Production screens call `exports:*` instead.
 */

/** Sample project the Export mock-up is built on. Not an IPC type. */
export const EXPORT_PROJECT_NAME = 'TextBolt'

const RUNS = ['2026-09-21', '2026-10-05', '2026-10-19'] as const
const PROJECT_PAGE_COUNT = 186

export const EXPORT_MARKETS = [
  { id: 'us', name: '🇺🇸 US · EN', short: 'United States', code: 'us-en' },
  { id: 'austin', name: '🇺🇸 US · Austin · EN', short: 'Austin, Texas', code: 'austin-en' },
  { id: 'uk', name: '🇬🇧 UK · EN', short: 'United Kingdom', code: 'uk-en' },
  { id: 'mx', name: '🇲🇽 MX · ES', short: 'Mexico', code: 'mx-es' }
] as const

export function previewForRequest(request: ExportRequest): ExportPreview {
  const math = measure(request)
  const illegalRaw = request.sections.includes('raw') && request.format !== 'json'
  let reason: string | null = null
  let nextStep: string | null = null
  if (request.marketIds.length === 0) {
    reason = 'Pick at least one market.'
    nextStep = 'Add a market to this page, then open Export again.'
  } else if (illegalRaw) {
    reason = 'Raw search data is only included in JSON exports.'
    nextStep = 'Choose JSON, or turn off Raw search data.'
  } else if (math.included.length === 0) {
    reason = 'Pick at least one section.'
    nextStep = 'Tick a section under Sections, or press Select all.'
  } else if (math.runs === 0) {
    reason = 'No checks fall in this date range.'
    nextStep = 'Widen the dates, or choose Every check.'
  } else if (math.pageCount === 0) {
    reason = 'Pick at least one page.'
    nextStep = 'Add a page to track, or choose Whole project.'
  }
  return {
    blocked: reason !== null,
    reason,
    nextStep,
    pageCount: math.pageCount,
    marketCount: request.marketIds.length,
    checkCount: math.runs,
    sections: math.included,
    estimatedBytes: reason === null ? math.bytes : 0,
    preview: previewBody(request, math.included)
  }
}

export function fileNameFor(request: ExportRequest): string {
  const ext = fileExtension(request.format, request.html?.packaging ?? 'zip')
  const pattern = request.filenamePattern || '{project}-{page}-{date}.{ext}'
  return pattern
    .split('{project}')
    .join(EXPORT_PROJECT_NAME)
    .split('{page}')
    .join(pageSlug(request))
    .split('{date}')
    .join('2026-10-19')
    .split('{ext}')
    .join(ext)
}

interface Measure {
  pageCount: number
  runs: number
  runDates: readonly string[]
  included: ExportSection[]
  nonRaw: ExportSection[]
  pdfPages: number
  bytes: number
}

function measure(request: ExportRequest): Measure {
  const pageCount = pagesFor(request)
  const runDates = runsFor(request)
  const runs = runDates.length
  const illegalRaw = request.sections.includes('raw') && request.format !== 'json'
  const included = illegalRaw
    ? []
    : request.sections.filter((section) => section !== 'raw' || request.format === 'json')
  const nonRaw = included.filter(
    (section): section is Exclude<ExportSection, 'raw'> => section !== 'raw'
  )
  const mk = request.marketIds.length
  const pp = runs <= 1 ? 2 : 3
  let per = nonRaw.length > 0 ? 1 : 0
  for (const section of nonRaw) per += SECTION_PAGES[section](mk, pp)
  const pdfPages = per * pageCount
  const unit = pageCount * mk * runs
  const charts = request.pdf?.charts !== false
  const kb =
    request.format === 'pdf'
      ? pdfPages * (charts ? 140 : 60)
      : request.format === 'xlsx'
        ? unit * 6 * nonRaw.length
        : request.format === 'csv'
          ? unit * 3 * nonRaw.length
          : request.format === 'html'
            ? pdfPages * 100
            : unit * 12 * nonRaw.length + (included.includes('raw') ? unit * 1500 : 0)
  return {
    pageCount,
    runs,
    runDates,
    included: [...included],
    nonRaw: [...nonRaw],
    pdfPages,
    bytes: Math.max(0, Math.round(kb * 1024))
  }
}

/** PDF pages each section adds per tracked page, by markets and checks shown. */
const SECTION_PAGES: Record<Exclude<ExportSection, 'raw'>, (mk: number, pp: number) => number> = {
  overview: (mk) => mk,
  // Rendered only for a topic subject; a page export leaves it out.
  topic_coverage: () => 0,
  pages: () => 1,
  competition: (mk) => mk,
  reputation: () => 1,
  trends: (mk) => mk,
  universe: () => 1,
  sources: () => 1,
  answer_shape: () => 1,
  content_gaps: () => 2,
  prompts: (mk, pp) => mk * pp
}

function pagesFor(request: ExportRequest): number {
  if (request.scope === 'page' || request.scope === 'selected') return request.pageIds.length
  if (request.scope === 'project') return PROJECT_PAGE_COUNT
  return 0
}

function pageSlug(request: ExportRequest): string {
  if (request.scope === 'page') return 'text-alerts'
  if (request.scope === 'selected') return `${request.pageIds.length}-pages`
  if (request.scope === 'project') return 'all-pages'
  return 'view'
}

function runsFor(request: ExportRequest): readonly string[] {
  if (request.checks === 'latest') {
    const latest = RUNS[2]
    return latest ? [latest] : []
  }
  if (request.checks === 'trio' || request.checks === 'all') return [...RUNS]
  const from = request.from ?? ''
  const to = request.to ?? ''
  return RUNS.filter((run) => run >= from && run <= to)
}

function previewBody(request: ExportRequest, included: readonly ExportSection[]): string {
  if (request.format === 'csv' || request.format === 'xlsx') {
    return csvPreview(request.csv?.delimiter ?? 'comma')
  }
  if (request.format === 'json') {
    const codes = EXPORT_MARKETS.filter((market) => request.marketIds.includes(market.id)).map(
      (market) => market.code
    )
    return jsonPreview(codes)
  }
  if (included.length === 0) return ''
  return 'First page of the report.'
}

export function csvPreview(delimiter: 'comma' | 'semicolon'): string {
  const d = delimiter === 'semicolon' ? ';' : ','
  const rows = [
    ['market', 'prompt', 'status', 'position', 'links', 'change'],
    [
      'us-en',
      '"How can I send text alerts to my employees without hiring a developer or learning a new app?"',
      'page_cited',
      '2',
      '1',
      'gained'
    ],
    [
      'us-en',
      '"Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?"',
      'page_cited',
      '1',
      '1',
      'unchanged'
    ],
    [
      'us-en',
      '"How do I send a text to my field techs early Saturday morning when I\'m writing the update Friday afternoon?"',
      'not_cited',
      '',
      '0',
      'lost'
    ]
  ]
  return rows.map((row) => row.join(d)).join('\n')
}

export function jsonPreview(codes: readonly string[]): string {
  const listed = codes.map((code) => `"${code}"`).join(', ')
  return `{\n  "schemaVersion": 2,\n  "project": "TextBolt",\n  "page": "/blog/how-to-set-up-text-alerts-for-business/",\n  "markets": [${listed}],\n  "checks": [\n    { "date": "2026-10-19", "score": 50,\n      "page_cited": 3, "ai_overviews": 8 },\n    ...\n  ]\n}`
}
