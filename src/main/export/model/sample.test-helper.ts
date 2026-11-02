import type { ExportRequest } from '@shared/ipc'
import { REPORT_SECTIONS } from '@shared/domain'
import { prepareExport } from '../prepare'
import { reportModelFor } from './from-dataset'
import { richSampleDataset } from './sample-dataset.test-helper'
import type { ReportModel } from './types'

/** The fixed build time of the sample report. */
export const SAMPLE_BUILT_AT = new Date('2026-10-20T12:00:00.000Z')

/** An export request over {@link richSampleDataset}. Page scope on the alerts page by default. */
export function sampleReportRequest(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    projectId: 'proj-textbolt',
    scope: 'page',
    pageIds: ['page-alerts'],
    viewId: null,
    marketIds: ['mkt-us', 'mkt-ca'],
    checks: 'all',
    from: null,
    to: null,
    sections: [...REPORT_SECTIONS],
    format: 'html',
    pdf: null,
    xlsx: null,
    csv: null,
    html: { packaging: 'zip' },
    filenamePattern: '{project}-{page}-{date}.{ext}',
    timeZone: 'UTC',
    logoBase64: null,
    ...overrides
  }
}

/** The report model of the rich TextBolt sample. Test and sample-output use only. */
export function sampleReportModel(overrides: Partial<ExportRequest> = {}): ReportModel {
  const dataset = richSampleDataset()
  const request = sampleReportRequest(overrides)
  const prepared = prepareExport(dataset, request)
  return reportModelFor(dataset, prepared.pages, request, SAMPLE_BUILT_AT)
}
