import type { EngineId } from '@shared/domain'
import type { MetricsRequest, ReportDownloadRequest, ReportTable } from '@shared/ipc'
import type { MetricsResult } from '@shared/metrics'
import {
  buildReport,
  LENS_LABELS,
  PAGE_STATUS_LABELS,
  pathOf,
  REPORT_TITLES,
  type ReportContext,
  type ReportKind,
  type ReviewReport
} from '@shared/report/review'
import { loadMetrics } from '../../metrics/assemble'
import {
  brandingMode,
  reportByline,
  type ReportBranding,
  type ReportByline,
  type ReportSender
} from '@shared/report/review'
import { loadAnswerShapes, loadReportExtras } from './extras'
import { loadChangedExtras } from './extras-changed'
import { loadSince } from './visibility-extras'
import { visibilityCsvRows } from './csv-visibility'
import { getMarket, listMarkets, readProjectProfile } from '../../storage/project-profile'
import type { SqliteDatabase } from '../../storage/database'
import type { ProjectRecord } from '../../storage/records'
import { encodeCsv } from '../csv'
import { neutralizeFormula } from '../formula'
import { calendarDay } from '../timezone'
import { reviewDocumentHtml, type ReviewVariant } from './document'
import { sourcesCsv } from './sources-csv'
import { contentPlanCsv } from './csv-ready'

/**
 * `reports:download` (Docs/REPORT-SPEC.md "Ready reports"): the ready report built from
 * `reports:metrics` with the same request, so the file shows the app's numbers.
 */

const ENGINE_NAMES: Readonly<Record<EngineId, string>> = {
  google_aio: 'Google AI Overview',
  google_ai_mode: 'Google AI Mode',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  copilot: 'Copilot'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 16" in the person's zone; the year is added when it is not this year's. */
export function dayIn(timeZone: string, now: Date): (iso: string) => string {
  const thisYear = calendarDay(now.toISOString(), timeZone).slice(0, 4)
  return (iso) => {
    const day = calendarDay(iso, timeZone)
    const [year, month, date] = day.split('-')
    const text = `${MONTHS[Number(month) - 1] ?? month} ${Number(date)}`
    return year === thisYear ? text : `${text}, ${year}`
  }
}

export interface ReviewBuild {
  kind: ReportKind
  variants: ReviewVariant[]
  /** The view of the request's own engine (the first variant). */
  report: ReviewReport
  metrics: MetricsResult
  domain: string
  scopeLabel: string
  marketLabel: string
  /** The market picked, for the file name; null: each page's own. */
  marketId: string | null
  branding: ReportBranding
  /** Who the report is from (Settings › Reports); null: today's look. */
  byline: ReportByline | null
}

/** Settings › Reports for a download: the app-wide sender and the site-icon lookup. */
export interface DownloadSender {
  sender: ReportSender
  /** The project site's stored icon (an in-house company's logo when it has none). */
  brandIcon?: (domain: string) => string | null
}

function marketText(db: SqliteDatabase, marketId: string | null): string {
  const markets = listMarkets(db)
  // No market picked: each page in its own default market (one market: that one).
  const market =
    marketId === null
      ? markets.length === 1
        ? (markets[0] ?? null)
        : null
      : (getMarket(db, marketId) ?? null)
  if (market === null) return 'each page’s market'
  const language = market.language.split('-')[0]?.toUpperCase() ?? market.language
  return `${market.country}${market.location ? ` · ${market.location}` : ''} · ${language}`
}

function scopeText(db: SqliteDatabase, request: MetricsRequest): string {
  if (request.scope.kind === 'project') return 'Whole project'
  const row = db
    .prepare<unknown[], { label: string | null; title: string | null; url: string | null }>(
      'SELECT label, title, url FROM pages WHERE id = ?'
    )
    .get(request.scope.id)
  const name = row?.label ?? row?.title ?? row?.url ?? request.scope.id
  return `${request.scope.kind === 'topic' ? 'Topic' : 'Page'}: ${name}`
}

/** The report for the request, plus one view per engine when it reads All engines. */
export function buildReviewDownload(
  db: SqliteDatabase,
  project: ProjectRecord,
  request: ReportDownloadRequest,
  now: Date,
  from: DownloadSender | null = null
): ReviewBuild {
  const profile = readProjectProfile(db)
  const marketLabel = marketText(db, request.marketId)
  const scopeLabel = scopeText(db, request)
  const ctxFor = (engine: EngineId | 'all'): ReportContext => ({
    brand: profile?.brandNames[0] ?? project.name,
    domain: project.domain,
    kind: request.report,
    day: dayIn(request.timeZone, now),
    marketLabel,
    engineLabel: engine === 'all' ? 'all engines' : ENGINE_NAMES[engine],
    scopeLabel,
    ...(request.rival ? { rival: request.rival } : {})
  })
  const base: MetricsRequest = {
    projectId: request.projectId,
    scope: request.scope,
    marketId: request.marketId,
    engine: request.engine,
    from: request.from,
    to: request.to
  }
  const metrics = loadMetrics(db, project, base)
  const extras = loadReportExtras(db, project, metrics, now)
  const report = buildReport(metrics, ctxFor(request.engine), extras)
  const variants: ReviewVariant[] = [
    {
      view: request.engine,
      label: request.engine === 'all' ? 'All engines' : ENGINE_NAMES[request.engine],
      report,
      metrics
    }
  ]
  if (request.engine === 'all' && metrics.offeredEngines.length >= 2) {
    for (const engine of metrics.offeredEngines) {
      const own = loadMetrics(db, project, { ...base, engine })
      // Shapes are per row; the rest (backlinks, owners, branding) is the same for every engine.
      const ownExtras = {
        ...extras,
        shapes: loadAnswerShapes(db, own),
        ...loadChangedExtras(db, project, own),
        ...(extras.visibility
          ? { visibility: { ...extras.visibility, since: loadSince(db, project, own) } }
          : {})
      }
      variants.push({
        view: engine,
        label: ENGINE_NAMES[engine],
        report: buildReport(own, ctxFor(engine), ownExtras),
        metrics: own
      })
    }
  }
  return {
    kind: request.report,
    variants,
    report,
    metrics,
    domain: project.domain,
    scopeLabel,
    marketLabel,
    marketId: request.marketId,
    branding: extras.branding,
    byline: bylineFor(from, extras.branding, profile?.brandNames[0] ?? project.name, project.domain)
  }
}

function bylineFor(
  from: DownloadSender | null,
  branding: ReportBranding,
  brand: string,
  domain: string
): ReportByline | null {
  if (from === null) return null
  const icon =
    brandingMode(from.sender) === 'company' && from.sender.logo === null
      ? (from.brandIcon?.(domain) ?? null)
      : null
  return reportByline(from.sender, branding, brand, icon)
}

type Cell = string | number | null

/** UTF-8 with a BOM so Excel opens it cleanly; formula-looking text is neutralized. */
function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const text = (cell: Cell): string => neutralizeFormula(cell === null ? '' : String(cell))
  return encodeCsv([header.map(text), ...rows.map((row) => row.map(text))], ',', true)
}

export function reviewFileBase(build: ReviewBuild, now: Date, timeZone: string): string {
  const domain = build.domain.toLowerCase().replace(/[^a-z0-9.-]+/g, '-') || 'site'
  const kind = REPORT_TITLES[build.kind].toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const market =
    build.marketId === null
      ? ''
      : `-${build.marketLabel
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`
  return `${domain}-${kind}${market}-${calendarDay(now.toISOString(), timeZone)}`
}

export function reviewHtml(build: ReviewBuild, now: Date, timeZone: string): string {
  return reviewDocumentHtml({
    title: REPORT_TITLES[build.kind],
    domain: build.domain,
    scopeLabel: build.scopeLabel,
    marketLabel: build.marketLabel,
    builtLabel: dayIn(timeZone, now)(now.toISOString()),
    fileBase: reviewFileBase(build, now, timeZone),
    variants: build.variants,
    branding: build.branding,
    byline: build.byline
  })
}

/** One table of the report as CSV (the request's own engine). */
export function reviewCsv(build: ReviewBuild, table: ReportTable): string {
  const { report } = build
  const plan = contentPlanCsv(report, table)
  if (plan !== null) return toCsv(plan.header, plan.rows)
  const sources = sourcesCsv(report, table)
  if (sources !== null) return toCsv(sources.header, sources.rows)
  const from = report.fromLabel
  const result = (value: string | null): string => value ?? ''
  const visibility = visibilityCsvRows(report, table)
  if (visibility !== null) return toCsv(visibility.header, visibility.rows)
  if (table === 'questions') {
    const at = (value: number | null): number | string => value ?? ''
    return toCsv(
      [
        'Question',
        'Topic',
        'Target page',
        'Also OK pages',
        'Funnel',
        'Intent',
        ...(from ? [from] : []),
        report.toLabel,
        'Change',
        ...(from ? [`Position ${from}`] : []),
        `Position ${report.toLabel}`,
        'Cited through'
      ],
      report.questions.rows.map((row) => [
        row.text,
        row.topic,
        row.targets[0] ?? '',
        row.targets.slice(1).join(' | '),
        row.funnel ?? '',
        row.intent ?? '',
        ...(from ? [result(row.before)] : []),
        result(row.now),
        row.change ?? (from ? 'not compared' : ''),
        ...(from ? [at(row.positionBefore)] : []),
        at(row.positionNow),
        row.page === null ? '' : pathOf(row.page)
      ])
    )
  }
  if (table === 'pages' || table === 'notindexed') {
    const rows = table === 'pages' ? report.published.rows : report.notIndexed.rows
    return toCsv(
      [
        'Page',
        'Kind',
        'Live since',
        'Days live',
        'Google index',
        ...(from ? [`Questions ${from}`] : []),
        `Questions ${report.toLabel}`,
        'Status'
      ],
      rows.map((row) => [
        row.url,
        row.kind ?? '',
        row.liveSince ?? '',
        row.daysLive,
        row.indexed === null ? '' : row.indexed ? 'Indexed' : 'Not indexed',
        ...(from ? [row.before] : []),
        row.now,
        PAGE_STATUS_LABELS[row.status]
      ])
    )
  }
  if (table === 'competitors') {
    return toCsv(
      [
        'Rank',
        'Site',
        'Kind',
        ...(from ? [from] : []),
        report.toLabel,
        ...(from ? ['Change'] : []),
        'With you',
        'Gap',
        ...(from ? [`Avg position ${from}`] : []),
        `Avg position ${report.toLabel}`
      ],
      report.competition.sites.map((site) => [
        site.rank,
        site.domain,
        site.kindLabel,
        ...(from ? [site.before?.n ?? null] : []),
        site.now.n,
        ...(from ? [site.change] : []),
        site.withYou?.n ?? null,
        site.gap?.n ?? null,
        ...(from ? [site.positionBefore] : []),
        site.positionNow
      ])
    )
  }
  if (table === 'sitekinds') {
    return toCsv(
      [
        'Kind of site',
        'Sites',
        ...(from ? [`Citations ${from}`] : []),
        `Citations ${report.toLabel}`,
        ...(from ? ['Change'] : [])
      ],
      report.competition.kinds.map((row) => [
        row.label,
        row.sites,
        ...(from ? [row.before] : []),
        row.now,
        ...(from ? [row.change] : [])
      ])
    )
  }
  if (table === 'backlinks') {
    return toCsv(
      ['Priority', 'Page', 'URL', 'Suggested anchor text', 'Why', 'Days live'],
      report.backlinks.rows.map((row) => [
        row.priority === 'first' ? 'First' : 'Next',
        row.title ?? pathOf(row.url),
        row.url,
        row.anchor,
        row.reason,
        row.daysLive
      ])
    )
  }
  const rows = (Object.keys(report.topics.lenses) as (keyof typeof report.topics.lenses)[]).flatMap(
    (lens) =>
      report.topics.lenses[lens].map((row) => [
        LENS_LABELS[lens],
        row.value,
        row.questions.n,
        ...(from ? [row.before?.n ?? null] : []),
        row.now.n,
        row.shareNow === null ? null : Math.round(row.shareNow * 100),
        row.open.n,
        report.visibility.topics.rows[lens][row.value]?.answered.n ?? null,
        report.visibility.topics.rows[lens][row.value]?.named.n ?? null
      ])
  )
  return toCsv(
    [
      'Lens',
      'Value',
      'Questions',
      ...(from ? [`Cited ${from}`] : []),
      `Cited ${report.toLabel}`,
      'Share now (%)',
      'Answer, not you',
      'Answer shown',
      'Brand named'
    ],
    rows
  )
}
