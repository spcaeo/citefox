import type { MetricsResult } from '@shared/metrics'
import { pageStory, type PageStory, type ReviewReport } from '@shared/report/review'
import { formatDay } from '../../utils/dates'

/** The story of a page: built with the report for published pages, else on the spot. */
export function storyOf(
  report: ReviewReport,
  metrics: MetricsResult,
  url: string
): PageStory | null {
  return report.impact.stories[url] ?? pageStory(report, metrics, url, formatDay)
}
