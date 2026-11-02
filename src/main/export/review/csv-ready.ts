import type { ReportTable } from '@shared/ipc'
import type { ReviewReport } from '@shared/report/review'

type Cell = string | number | null

/**
 * The Content plan as CSV (Docs/REPORT-SPEC.md "Short ready reports"): one row per
 * question to win, with the page to write or fix, the answer shape and the sites to beat.
 * Null for any other table.
 */
export function contentPlanCsv(
  report: ReviewReport,
  table: ReportTable
): { header: string[]; rows: Cell[][] } | null {
  if (table !== 'contentplan') return null
  return {
    header: [
      'Topic',
      'Question',
      'Why',
      'Page to write or fix',
      'Page from',
      'Answer shape',
      'Sites cited instead',
      'Brief'
    ],
    rows: report.ready.content.groups.flatMap((group) =>
      group.rows.map((row) => [
        group.topic,
        row.question.text,
        row.reason === 'wrongpage' ? 'Wrong page cited' : 'Not cited',
        row.page ?? 'New page',
        row.pageLabel,
        row.shape === null ? '' : row.shape.label,
        row.sites.join(' | '),
        row.brief
      ])
    )
  }
}
