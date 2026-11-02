import { describe, expect, test } from 'vitest'
import type { PromptCheckRow } from '@shared/domain'
import { aioSharePct } from '@shared/report-copy'
import { buildFunnel } from '../../engine/checks/score'
import { renderHtmlReport } from '../html'
import { prepareExport } from '../prepare'
import type { ExportDataset } from '../types'
import { reportModelFor } from './from-dataset'
import { richSampleDataset } from './sample-dataset.test-helper'
import { SAMPLE_BUILT_AT, sampleReportRequest } from './sample.test-helper'

/**
 * "AI Overview appears" as a share is one definition (SRS section 7.2 AIO coverage):
 * prompts with an AI Overview ÷ ALL tracked prompts. A live AU check had 8 of 10 with
 * 2 searches failed: the app said 80%, the report said "100% of measured". For a run
 * with failed searches the two percentages must match, and the failures are stated apart.
 */
const RUN = 'run-us-3'

function withFailedSearches(failures: number): ExportDataset {
  const dataset = richSampleDataset()
  const run = dataset.pages
    .find((item) => item.pageId === 'page-alerts')
    ?.markets.find((item) => item.marketId === 'mkt-us')
    ?.checks.find((check) => check.metrics.runId === RUN)
  if (!run) throw new Error('sample run missing')
  let left = failures
  const prompts = run.prompts.map((row): PromptCheckRow => {
    if (left === 0 || row.status === 'error' || row.status === 'no_aio') return row
    left -= 1
    return { ...row, status: 'error', named: null, position: null, citedUrl: null }
  })
  ;(run as { prompts: readonly PromptCheckRow[] }).prompts = prompts
  return dataset
}

function both(dataset: ExportDataset): {
  app: number | null
  report: ReturnType<typeof reportModelFor>
  prompts: readonly PromptCheckRow[]
} {
  const prompts =
    dataset.pages
      .find((item) => item.pageId === 'page-alerts')
      ?.markets.find((item) => item.marketId === 'mkt-us')
      ?.checks.find((check) => check.metrics.runId === RUN)?.prompts ?? []
  // The app's Results funnel: "AI Overview appears" ÷ "Prompts checked" (every prompt).
  const funnel = buildFunnel(prompts)
  const shown = funnel.find((step) => step.id === 'aio_shown')?.count ?? -1
  const checked = funnel.find((step) => step.id === 'checked')?.count ?? -1
  const request = sampleReportRequest({ marketIds: ['mkt-us'] })
  const report = reportModelFor(
    dataset,
    prepareExport(dataset, request).pages,
    request,
    SAMPLE_BUILT_AT
  )
  expect(report.rows.every((row) => row.runId === RUN)).toBe(true)
  return { app: aioSharePct(shown, checked), report, prompts }
}

describe('AI Overview share: app and report agree', () => {
  test('with 2 failed searches the report percentage equals the app percentage', () => {
    const { app, report, prompts } = both(withFailedSearches(2))
    const errors = prompts.filter((row) => row.status === 'error')
    expect(errors).toHaveLength(2)
    const aio = prompts.filter((row) => row.status !== 'error' && row.status !== 'no_aio').length
    expect(report.overview.aio.n).toBe(aio)
    expect(report.overview.tracked.n).toBe(prompts.length)
    // Share of all tracked prompts, not of the measured ones.
    expect(report.overview.aioPct).toBe(Math.round((aio / prompts.length) * 100))
    expect(report.overview.aioPct).not.toBe(Math.round((aio / (prompts.length - 2)) * 100))
    expect(report.overview.aioPct).toBe(app)
  })

  test('failed searches are counted apart and drill to exactly those prompts', () => {
    const { report, prompts } = both(withFailedSearches(2))
    const failed = report.overview.failed
    expect(failed.n).toBe(2)
    const ids = report.drills[failed.drill ?? ''] ?? []
    const rows = report.rows.filter((row) => ids.includes(row.id))
    expect(rows.map((row) => row.promptId).sort()).toEqual(
      prompts
        .filter((row) => row.status === 'error')
        .map((row) => row.promptId)
        .sort()
    )
    expect(rows.every((row) => row.status === 'error')).toBe(true)
  })

  test('the HTML report says "of tracked" and "2 searches failed", with a drill', () => {
    const { report } = both(withFailedSearches(2))
    const html = renderHtmlReport(report, { secrets: [] })
    expect(html).toContain(`${report.overview.aioPct}% of tracked · 2 searches failed`)
    expect(html).not.toContain('of measured')
    expect(html).toMatch(/data-drill="failed"[^>]*data-n="2"/)
  })

  test('no failures: the same share, and no failure line', () => {
    const { app, report } = both(richSampleDataset())
    expect(report.overview.aioPct).toBe(app)
    expect(report.overview.failed.n).toBe(0)
  })
})
