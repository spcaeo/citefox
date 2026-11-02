import type { ReportTable } from '@shared/ipc'
import type { ReviewReport } from '@shared/report/review'

type Cell = string | number | null

/**
 * The Visibility report's tables as CSV rows (`reports:download` with a table): target
 * pages, other own pages cited, wrong claims and answer by answer. The same rows the app
 * and the offline file show. Null: not one of these tables.
 */
export function visibilityCsvRows(
  report: ReviewReport,
  table: ReportTable
): { header: string[]; rows: Cell[][] } | null {
  const v = report.visibility
  if (table === 'targetpages') {
    return {
      header: [
        'Page',
        'Role',
        'Set for',
        ...v.targets.engines.map((e) => e.label),
        'Total',
        'Not cited yet'
      ],
      rows: v.targets.rows.map((row) => [
        row.url,
        row.role,
        row.questions.n,
        ...row.engines.map((cell) => cell.n),
        row.total.n,
        row.notCited ? 'Yes' : ''
      ])
    }
  }
  if (table === 'otherpages') {
    return {
      header: ['Page', 'Questions', 'Cited on'],
      rows: v.targets.others.map((row) => [
        row.url,
        row.questions.n,
        row.items.map((item) => item.text).join(' | ')
      ])
    }
  }
  if (table === 'claims') {
    return {
      header: ['Question', 'Brand', 'Claim', 'Problem', 'Suggested correction', 'Source to fix'],
      rows: v.reputation.issues.map((issue) => [
        issue.questionText,
        issue.brand,
        issue.claim,
        issue.why,
        issue.correction,
        issue.sourceToFix ?? ''
      ])
    }
  }
  if (table === 'answers') {
    return {
      header: ['Question', 'Tone', 'Theme', 'Rank', 'Why'],
      rows: v.reputation.rows.map((row) => [
        row.question.text,
        row.tone,
        row.theme ?? '',
        row.rank,
        row.reason ?? ''
      ])
    }
  }
  return null
}
