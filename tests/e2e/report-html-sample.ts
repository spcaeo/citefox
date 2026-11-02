import { renderHtmlReport } from '../../src/main/export/html'
import { fullReportModel } from '../../src/main/export/html/report-model.test-helper'

/**
 * The HTML report of the rich TextBolt sample (two markets, three full checks and a
 * partial follow-up), for report-html.spec.ts. Loaded through Vite's SSR loader so the
 * spec can open a report that has an earlier full check to compare with.
 */
export function sampleReportHtml(): string {
  return renderHtmlReport(fullReportModel(), { secrets: [] })
}
