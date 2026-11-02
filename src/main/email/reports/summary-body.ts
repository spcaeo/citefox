import type { ReportFormat } from '@shared/domain'
import { formatLongDate } from '../../export/model/format'
import type { DeltaList, ReportModel } from '../../export/model/types'

/**
 * The plain-text body of a scheduled report email (Docs/REPORT-SPEC.md "Other outputs"):
 * the one-sentence headline, score and change, what changed, what to do next (at most
 * three, each with its reason), and what is attached.
 * Built from the same report model as the attachment, so the numbers agree.
 */

/** What each schedule format attaches, in the words the email and the app both use. */
export const REPORT_ATTACHMENT_LABELS: Record<ReportFormat, string | null> = {
  pdf: 'PDF report',
  excel: 'Excel workbook (one sheet per section table)',
  csv: 'CSV tables (.zip, one file per table)',
  html_link: 'Interactive HTML report (.zip with index.html and README.txt; works offline)',
  summary: null
}

/** The last line of every scheduled report email. Reports lives under Tracking › Reports. */
export const REPORT_EMAIL_FOOTER =
  'Sent by CiteFox from this computer. Change or stop this report in CiteFox › Reports.'

const PROMPT_CHARS = 90
const LIST_ITEMS = 3

/**
 * `preparedBy` is who the reports are from (Settings › Reports: the agency, or an in-house
 * team's "Prepared by"); empty: no line, today's email.
 */
export function reportSummaryLines(
  model: ReportModel,
  format: ReportFormat,
  preparedBy = ''
): string[] {
  const { cover, overview } = model
  const tz = cover.timeZone
  const markets = model.markets.map((market) => market.label).join(', ')
  const lines: string[] = [
    cover.title,
    [
      cover.scopeLabel,
      markets.length > 0 ? markets : null,
      `built ${formatLongDate(cover.builtAt, tz)}`
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    '',
    ...reportFactLines(model)
  ]

  const attachment = REPORT_ATTACHMENT_LABELS[format]
  lines.push(
    '',
    attachment === null
      ? 'No file is attached: this schedule sends the summary only.'
      : `Attached: ${attachment}. Every number in the report opens the prompts behind it.`,
    '',
    overview.coverageLine,
    ...(preparedBy ? [`Prepared by ${preparedBy}`] : []),
    'Built with CiteFox',
    '',
    REPORT_EMAIL_FOOTER
  )
  return lines
}

/**
 * The report's own numbers, as the email body states them: the headline, score and
 * change, what changed (the top movers) and what to do next. "✦ Help me fill this"
 * hands the same lines to the user's chatbot for a summary in their own voice.
 */
export function reportFactLines(model: ReportModel): string[] {
  const { overview, trends } = model
  const lines: string[] = [model.headline, '', scoreLine(model)]

  lines.push('', 'What changed since the previous full check:')
  const changes: [string, DeltaList][] = [
    ['Gained citations', trends.gained],
    ['Lost citations', trends.lost],
    ['Newly named', trends.newlyNamed],
    ['No longer named', trends.noLongerNamed]
  ]
  if (trends.previousAt === null) {
    lines.push(
      '- This is the first full check in the data window, so there is nothing to compare yet.'
    )
  } else if (changes.every(([, list]) => list.count.n === 0)) {
    lines.push('- No changes in citations or brand mentions.')
  } else {
    for (const [label, list] of changes) {
      if (list.count.n === 0) continue
      lines.push(`- ${label}: ${list.count.n}`)
      for (const item of list.items.slice(0, LIST_ITEMS)) {
        lines.push(`  · "${clip(item.prompt)}" (${item.before} → ${item.after})`)
      }
      if (list.items.length > LIST_ITEMS) {
        lines.push(`  · and ${list.items.length - LIST_ITEMS} more in the report`)
      }
    }
  }

  lines.push('', 'What to do next:')
  if (model.recommendations.length > 0) {
    // The report's own recommendations, each tied to the questions that show why.
    model.recommendations.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.doThis}`, `   Why: ${item.why}`)
    })
  } else if (overview.topActions.length === 0) {
    lines.push('- No actions yet. Run the coverage analysis on a page to get specific fixes.')
  } else {
    overview.topActions.slice(0, 3).forEach((action, index) => {
      const reason = action.reason.trim().length > 0 ? ` — ${action.reason}` : ''
      lines.push(`${index + 1}. ${action.text}${reason}`)
    })
  }
  return lines
}

function scoreLine(model: ReportModel): string {
  const { score, scoreChange, previousCheckAt } = model.overview
  if (score === null) return 'Visibility score: not available yet (no AI Overview in scope).'
  if (scoreChange === null || previousCheckAt === null) {
    return `Visibility score: ${score} of 100. There is no earlier full check to compare with.`
  }
  const since = formatLongDate(previousCheckAt, model.cover.timeZone)
  if (scoreChange === 0) return `Visibility score: ${score} of 100, unchanged since ${since}.`
  const direction = scoreChange > 0 ? 'up' : 'down'
  return `Visibility score: ${score} of 100, ${direction} ${Math.abs(scoreChange)} since the previous full check on ${since}.`
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= PROMPT_CHARS ? flat : `${flat.slice(0, PROMPT_CHARS - 1).trimEnd()}…`
}
