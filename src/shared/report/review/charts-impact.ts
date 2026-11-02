import type { RankedBarsInput } from '../../charts'
import type { ReviewReport } from './types'

/** Verdict's "Most cited sites": the top 8 now, the faint bar the From check, you highlighted. */
export function topSitesChart(report: ReviewReport): Omit<RankedBarsInput, 'width' | 'titles'> {
  return {
    label: `Most cited sites, ${report.toLabel}`,
    nowLabel: report.toLabel,
    ...(report.fromLabel && report.comparing ? { previousLabel: report.fromLabel } : {}),
    items: report.impact.topSites.map((site) => ({
      id: site.nowDrill,
      label: site.own ? `${site.domain} (you)` : site.domain,
      value: site.now,
      previous: site.before,
      highlight: site.own
    }))
  }
}
