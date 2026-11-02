import { describe, expect, test } from 'vitest'
import type { PromptCheckRow } from '@shared/domain'
import { buildBuckets } from '../../engine/checks/score'
import { prepareExport } from '../prepare'
import type { ExportDataset } from '../types'
import { reportModelFor } from './from-dataset'
import { richSampleDataset } from './sample-dataset.test-helper'
import { SAMPLE_BUILT_AT, sampleReportRequest } from './sample.test-helper'

/**
 * "Already winning" is one definition (cited AND named, Docs/REPORT-SPEC.md) used by the
 * exported report and the in-app Results screen. The live TextBolt run showed 2 in the
 * report and 0 in the app (another textbolt.com page cited and TextBolt named, but not the
 * tracked page). For the same run the two numbers must match.
 */
function winningBoth(dataset: ExportDataset): { app: number; report: number } {
  const run = dataset.pages
    .find((item) => item.pageId === 'page-alerts')
    ?.markets.find((item) => item.marketId === 'mkt-us')
    ?.checks.find((check) => check.metrics.runId === 'run-us-3')
  const prompts = run?.prompts ?? []
  const app = buildBuckets(prompts).find((bucket) => bucket.id === 'winning')?.count ?? -1
  const request = sampleReportRequest({ marketIds: ['mkt-us'] })
  const model = reportModelFor(
    dataset,
    prepareExport(dataset, request).pages,
    request,
    SAMPLE_BUILT_AT
  )
  expect(model.rows.every((row) => row.runId === 'run-us-3')).toBe(true)
  return { app, report: model.overview.winning.n }
}

/** The live run's shape: every own-domain citation is another page, and the brand is named. */
function liveShaped(): ExportDataset {
  const dataset = richSampleDataset()
  const run = dataset.pages
    .find((item) => item.pageId === 'page-alerts')
    ?.markets.find((item) => item.marketId === 'mkt-us')
    ?.checks.find((check) => check.metrics.runId === 'run-us-3')
  if (!run) throw new Error('sample run missing')
  const prompts = run.prompts.map((row): PromptCheckRow =>
    row.status === 'page_cited'
      ? { ...row, status: 'other_own_page', wrongPageCited: true, named: true }
      : row
  )
  ;(run as { prompts: readonly PromptCheckRow[] }).prompts = prompts
  return dataset
}

describe('Already winning: app and report agree', () => {
  test('the app bucket equals the report model for the same run', () => {
    const both = winningBoth(richSampleDataset())
    expect(both.app).toBe(both.report)
  })

  test('another own page cited and the brand named is winning in both (live run)', () => {
    const both = winningBoth(liveShaped())
    expect(both.report).toBeGreaterThan(0)
    expect(both.app).toBe(both.report)
  })
})
