import type { ReportSectionId } from '@shared/domain'
import { failedSearchesText, REPORT_KPI_LABELS, REPORT_SECTION_COPY } from '@shared/report-copy'
import { findingText } from '@shared/report/verdict'
import { redactString } from '../../logging'
import type { ReportModel } from '../model/types'
import { calendarDay } from '../timezone'
import { zipStore } from '../zip'
import { createContext, type RenderContext, type RenderedSection } from './context'
import { reportData } from './data'
import { documentHtml } from './document'
import { jsonForScript, slugId } from './escape'
import { pct } from './format'
import { renderAnswerShape } from './sections/answer-shape'
import { renderCompetition } from './sections/competition'
import { renderContentGaps } from './sections/content-gaps'
import { NEXT_STEPS_TITLE, renderNextSteps } from './sections/next-steps'
import { renderCover } from './sections/cover'
import { METHOD_TITLE, renderMethod } from './sections/method'
import { renderOverview } from './sections/overview'
import { renderPages } from './sections/pages'
import { renderPrompts } from './sections/prompts'
import { renderReputation } from './sections/reputation'
import { renderSources } from './sections/sources'
import { renderTopicCoverage } from './sections/topic-coverage'
import { renderTrends } from './sections/trends'
import { renderUniverse } from './sections/universe'
import { renderVerdict, VERDICT_TITLE } from './sections/verdict'
import { renderWhatChanged, WHAT_CHANGED_TITLE } from './sections/what-changed'

/**
 * The interactive HTML report (Docs/REPORT-SPEC.md "Delivery format"). One
 * self-contained `index.html` rendered from the report model only: inline CSS, inline
 * SVG charts, the data embedded once as JSON, and one script allowed by its hash.
 * Every section is complete without the script; the script adds drill-down, search,
 * focus mode, per-table CSV and table expansion.
 */

export { CLIENT_SCRIPT, CLIENT_SCRIPT_HASH } from './client/app'
export { CONTENT_SECURITY_POLICY } from './document'

export interface HtmlReportOptions {
  /** Values removed from every string in the file (NFR-5). */
  secrets: readonly string[]
}

export interface HtmlReportPackage {
  filename: string
  bytes: Buffer
  contentType: string
}

const RENDERERS: Record<ReportSectionId, (ctx: RenderContext) => RenderedSection> = {
  overview: renderOverview,
  topic_coverage: renderTopicCoverage,
  pages: renderPages,
  competition: renderCompetition,
  reputation: renderReputation,
  trends: renderTrends,
  universe: renderUniverse,
  sources: renderSources,
  answer_shape: renderAnswerShape,
  content_gaps: renderContentGaps,
  prompts: renderPrompts
}

export function renderHtmlReport(model: ReportModel, options: HtmlReportOptions): string {
  const safe = redactModel(model, options.secrets)
  const ctx = createContext(safe)
  const sections: RenderedSection[] = [renderCover(ctx)]
  // The verdict reads the overview's numbers and "What to do next" (only with evidence)
  // follows it; "What changed" sits after the overview, or before the trends when the
  // overview is not picked. "How this report was made" is last.
  if (safe.sections.includes('overview')) {
    sections.push(renderVerdict(ctx))
    if (safe.recommendations.length > 0) sections.push(renderNextSteps(ctx))
  }
  const wantsChanges = safe.sections.includes('overview') || safe.sections.includes('trends')
  let changesShown = false
  const pushChanges = (): void => {
    if (!wantsChanges || changesShown) return
    changesShown = true
    sections.push(renderWhatChanged(ctx))
  }
  for (const id of safe.sections) {
    const render = RENDERERS[id]
    if (render === undefined) continue
    if (id === 'trends') pushChanges()
    const section = render(ctx)
    // A sub-link whose heading was not rendered (an empty list) is left out of the nav.
    sections.push({
      ...section,
      subs: section.subs.filter((sub) => section.html.includes(`id="${sub.id}"`))
    })
    if (id === 'overview') pushChanges()
  }
  sections.push(renderMethod(ctx))
  const data = reportData(ctx, folderName(safe))
  return documentHtml({ model: safe, sections, dataJson: jsonForScript(data) })
}

/** A short text outline of the report for the export preview. Not the file. */
export function htmlReportPreviewText(model: ReportModel): string {
  const { cover, overview } = model
  const kpis = [
    `${REPORT_KPI_LABELS.tracked} ${overview.tracked.n}`,
    `${REPORT_KPI_LABELS.aio} ${overview.aio.n} (${pct(overview.aioPct)} of tracked)`,
    ...(overview.failed.n > 0 ? [failedSearchesText(overview.failed.n)] : []),
    `${REPORT_KPI_LABELS.cited} ${overview.cited.n} (${pct(overview.citedPct)})`,
    `${REPORT_KPI_LABELS.named} ${overview.named.n}`,
    `${REPORT_KPI_LABELS.notVisible} ${overview.notVisible.n}`,
    `${REPORT_KPI_LABELS.score} ${overview.score ?? '—'}`
  ]
  const hasOverview = model.sections.includes('overview')
  const sections = model.sections.flatMap((id) => {
    const line = `- ${REPORT_SECTION_COPY[id].title}`
    if (id === 'overview') return [line, `- ${WHAT_CHANGED_TITLE}`]
    if (id === 'trends' && !hasOverview) return [`- ${WHAT_CHANGED_TITLE}`, line]
    return [line]
  })
  const verdict = hasOverview
    ? [
        `${VERDICT_TITLE}: ${model.verdict.label}`,
        ...model.verdict.findings.map((finding) => `- ${findingText(finding)}`),
        ''
      ]
    : []
  const hasNext = hasOverview && model.recommendations.length > 0
  const nextSteps = hasNext
    ? [
        `${NEXT_STEPS_TITLE}:`,
        ...model.recommendations.map((item, index) => `${index + 1}. ${item.doThis}`),
        ''
      ]
    : []
  return [
    cover.title,
    `${cover.domain} · ${cover.scopeLabel}`,
    '',
    model.headline,
    '',
    ...verdict,
    ...nextSteps,
    kpis.join(' · '),
    '',
    'Sections:',
    '- Cover',
    ...(hasOverview ? [`- ${VERDICT_TITLE}`] : []),
    ...(hasNext ? [`- ${NEXT_STEPS_TITLE}`] : []),
    ...sections,
    `- ${METHOD_TITLE}`,
    '',
    `Interactive HTML: every prompt count opens the prompts behind it. Works offline.`
  ].join('\n')
}

/**
 * The file to save. `zip` is a folder `<domain>-<scope>-ai-visibility-<date>/` holding
 * `index.html` and `README.txt`; `file` is the bare HTML under the same name.
 */
export function packageHtmlReport(
  model: ReportModel,
  html: string,
  packaging: 'zip' | 'file'
): HtmlReportPackage {
  const folder = folderName(model)
  if (packaging === 'file') {
    return {
      filename: `${folder}.html`,
      bytes: Buffer.from(html, 'utf8'),
      contentType: 'text/html; charset=utf-8'
    }
  }
  const bytes = zipStore([
    { name: `${folder}/index.html`, data: Buffer.from(html, 'utf8') },
    { name: `${folder}/README.txt`, data: Buffer.from(readme(model, folder), 'utf8') }
  ])
  return { filename: `${folder}.zip`, bytes, contentType: 'application/zip' }
}

/** `example.com-how-to-set-up-text-alerts-ai-visibility-2026-10-20`. */
export function folderName(model: ReportModel): string {
  const { cover } = model
  const domain =
    cover.domain
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'site'
  const scope = slugId(cover.scopeSlug)
  const day = calendarDay(cover.builtAt, cover.timeZone)
  return `${domain}-${scope}-ai-visibility-${day}`
}

function readme(model: ReportModel, folder: string): string {
  const { cover } = model
  return [
    `${cover.domain} — AI visibility report`,
    cover.scopeLabel,
    '',
    'HOW TO OPEN IT',
    `Unzip the folder, then double-click index.html. It opens in your web browser.`,
    `The report works offline: everything is inside index.html, and it makes no network requests.`,
    '',
    'WHAT YOU CAN CLICK',
    '- Every prompt count (KPI tiles, bars, chart segments and table cells) opens the prompts behind it,',
    '  with a summary: prompts, AI Overview shown, cited, named and the gap.',
    '- In that side panel, click a prompt to see its answer and every site it cites; click a site or a page',
    '  to see its prompts. Back (or Esc) goes one step back; the path at the top jumps further back.',
    '- Every view has its own address. Copy link copies it; opening the file with that address shows the',
    '  same view. The browser Back and Forward buttons move through the panel steps.',
    '- Search, at the top, finds prompts by their words, page or market. Press Enter to see them.',
    '- Focus hides the section list, for reading or screen-sharing.',
    '- CSV, above each table, downloads that table. The side panel has its own CSV button.',
    '- Copy all URLs copies every page address in a list, one per line.',
    '- "Show all" under a long table shows every row.',
    '- Print saves the whole report as a PDF: every table is expanded and the buttons are hidden.',
    '',
    'ABOUT THE NUMBERS',
    'Google AI Overviews only. Each prompt is counted once per market, from its latest full check.',
    'Partial checks are never in the totals. "No AI Overview" and failed checks are left out of the rates.',
    '',
    `Built with CiteFox · ${folder}`,
    ''
  ].join('\r\n')
}

const HASH_FIELDS = new Set(['hash', 'templateHash'])

/**
 * Removes secrets from every string in the model, record keys included, so drill
 * tokens and the counts that point at them stay in step. Template hashes keep their
 * hex (they are not keys); exact secrets are still removed from them.
 */
function redactModel(model: ReportModel, secrets: readonly string[]): ReportModel {
  const visit = (value: unknown, key: string | null): unknown => {
    if (typeof value === 'string') {
      return redactString(value, { secrets, hexKeys: key === null || !HASH_FIELDS.has(key) })
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, null))
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {}
      for (const [childKey, child] of Object.entries(value)) {
        const safeKey = key === 'drills' ? redactString(childKey, { secrets }) : childKey
        out[safeKey] = visit(child, childKey)
      }
      return out
    }
    return value
  }
  return visit(model, null) as ReportModel
}
