import type { ReportScope, ScheduledReport } from '@shared/domain'
import type { ReportDownloadRequest } from '@shared/ipc'
import type { MetricScope } from '@shared/metrics'
import { partsText, REPORT_TITLES, type ReviewReport } from '@shared/report/review'
import { REPORT_EMAIL_FOOTER } from '../../email/reports/summary-body'
import { redactString } from '../../logging/redact'
import type { SqliteDatabase } from '../../storage/database'
import type { ProjectRecord } from '../../storage/records'
import type { HtmlPdfPrinter } from './download'
import { buildReviewDownload, reviewFileBase, reviewHtml, type DownloadSender } from './index'
import { htmlProblems, qualityMessage } from './quality'

/**
 * A scheduled email that sends a ready report (Visibility, What changed, Impact
 * review, Pitch / audit, Content plan, Head-to-head): the same file Reports'
 * Download › PDF saves (`reports:download`), built from the same numbers, and a
 * short plain-text body from the report's own headline, tiles and next steps.
 */

export interface ReadyReportEmail {
  attachment: { filename: string; contentType: string; bytes: Uint8Array }
  lines: string[]
}

export interface ReadyReportInput {
  report: ScheduledReport
  scope: ReportScope | null
  marketIds: readonly string[]
  timeZone: string
  /** `html_link` sends the offline HTML file; every other format sends the PDF. */
  html: boolean
}

/**
 * The schedule's scope as a ready report reads it: one topic or one page as itself,
 * anything wider (several pages, a group, a cluster) as the whole project, the same
 * as the Reports screen's scope picker offers.
 */
export function readyReportScope(scope: ReportScope | null): MetricScope {
  if (scope === null || scope.ids.length !== 1) return { kind: 'project' }
  const id = scope.ids[0] as string
  if (scope.kind === 'topic') return { kind: 'topic', id }
  if (scope.kind === 'pages') return { kind: 'page', id }
  return { kind: 'project' }
}

export function readyReportRequest(
  projectId: string,
  input: ReadyReportInput
): ReportDownloadRequest {
  return {
    projectId,
    scope: readyReportScope(input.scope),
    marketId: input.marketIds.length === 1 ? (input.marketIds[0] ?? null) : null,
    engine: 'all',
    // The report's own default window: the latest check, or the latest pair to compare.
    from: null,
    to: null,
    report: input.report.kind,
    format: input.html ? 'html' : 'pdf',
    table: null,
    timeZone: input.timeZone,
    ...(input.report.kind === 'rival' && input.report.rival ? { rival: input.report.rival } : {})
  }
}

/**
 * Builds the ready report's file. Without a PDF printer (a background `--check-due`
 * run has no window to print with) the offline HTML file is attached instead, which
 * opens in any browser and prints to the same PDF. Throws when the file fails the
 * download's quality check, so the send is recorded as failed, never half a report.
 */
export async function buildReadyReportEmail(
  db: SqliteDatabase,
  project: ProjectRecord,
  input: ReadyReportInput,
  now: Date,
  options: {
    from: DownloadSender | null
    printer: HtmlPdfPrinter | null
    secrets: readonly string[]
    preparedBy?: string
  }
): Promise<ReadyReportEmail> {
  const request = readyReportRequest(project.id, input)
  const build = buildReviewDownload(db, project, request, now, options.from)
  const html = redactString(reviewHtml(build, now, input.timeZone), {
    secrets: options.secrets,
    hexKeys: false
  })
  const problems = htmlProblems(html, build.variants)
  if (problems.length > 0) throw new Error(qualityMessage(problems).reason)
  const base = reviewFileBase(build, now, input.timeZone)
  const asPdf = !input.html && options.printer !== null
  const attachment = asPdf
    ? {
        filename: `${base}.pdf`,
        contentType: 'application/pdf',
        bytes: await (options.printer as HtmlPdfPrinter)(html)
      }
    : { filename: `${base}.html`, contentType: 'text/html', bytes: Buffer.from(html, 'utf8') }
  const lines = readyReportLines(
    build.report,
    build.domain,
    asPdf ? 'pdf' : 'html',
    options.preparedBy
  )
  return {
    attachment,
    lines: lines.map((line) => redactString(line, { secrets: options.secrets, hexKeys: false }))
  }
}

const LIST_ITEMS = 3

/** The email body: title, the verdict sentence, three tiles, three next steps, the file. */
export function readyReportLines(
  report: ReviewReport,
  domain: string,
  file: 'pdf' | 'html',
  preparedBy = ''
): string[] {
  const lines: string[] = [`${REPORT_TITLES[report.kind]} · ${domain} · ${report.windowLabel}`, '']
  if (report.needs !== null) {
    lines.push(report.needs.lead)
  } else {
    const headline = partsText(report.verdict.headline).trim()
    if (headline) lines.push(headline)
    const kpis = report.verdict.kpis.slice(0, LIST_ITEMS)
    if (kpis.length > 0) {
      lines.push('')
      for (const kpi of kpis) {
        lines.push(`${kpi.label}: ${kpi.now}${kpi.before === null ? '' : ` (was ${kpi.before})`}`)
      }
    }
    const next = report.verdict.next.slice(0, LIST_ITEMS)
    if (next.length > 0) {
      lines.push('', 'What to do next:')
      for (const step of next) lines.push(`- ${step.lead} ${partsText(step.parts)}`.trimEnd())
    }
  }
  lines.push(
    '',
    file === 'pdf'
      ? 'Attached: the full report as a PDF.'
      : 'Attached: the full report as an HTML file. It works offline; print it to save a PDF.',
    ...(preparedBy ? [`Prepared by ${preparedBy}`] : []),
    'Built with CiteFox',
    '',
    REPORT_EMAIL_FOOTER
  )
  return lines
}
