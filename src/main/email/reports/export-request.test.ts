import type { ReportSchedule } from '@shared/domain'
import { REPORT_SECTIONS } from '@shared/domain'
import { describe, expect, test } from 'vitest'
import { reportContentType, reportExportRequest, reportModelRequest } from './export-request'

describe('scheduled report export request', () => {
  test('the HTML report schedule attaches the zipped interactive report', () => {
    const request = reportExportRequest(schedule({ format: 'html_link' }), 'proj-1')
    expect(request).toMatchObject({
      projectId: 'proj-1',
      scope: 'project',
      checks: 'all',
      format: 'html',
      html: { packaging: 'zip' },
      pdf: null,
      xlsx: null,
      csv: null,
      timeZone: 'America/Toronto'
    })
    expect(reportContentType('html_link')).toBe('application/zip')
  })

  test('PDF, Excel, and CSV keep their options; legacy sections map to v2 and raw is dropped', () => {
    expect(reportExportRequest(schedule({ format: 'pdf' }), 'proj-1')).toMatchObject({
      format: 'pdf',
      pdf: { pageSize: 'letter', charts: true, preparedFor: null, hideBranding: false },
      sections: ['overview', 'trends']
    })
    expect(reportExportRequest(schedule({ format: 'excel' }), 'proj-1')).toMatchObject({
      format: 'xlsx',
      xlsx: { freezeHeaders: true, sheetPerMarket: false }
    })
    expect(reportExportRequest(schedule({ format: 'csv' }), 'proj-1')).toMatchObject({
      format: 'csv',
      csv: { delimiter: 'comma', bom: true }
    })
    expect(reportContentType('pdf')).toBe('application/pdf')
    expect(reportContentType('csv')).toBe('application/zip')
  })

  test('a summary-only schedule has no file; no sections means every report section', () => {
    expect(reportExportRequest(schedule({ format: 'summary' }), 'proj-1')).toBeNull()
    expect(reportModelRequest(schedule({ format: 'summary' }), 'proj-1').sections).toEqual([
      'overview',
      'trends'
    ])
    expect(
      reportExportRequest(schedule({ format: 'pdf', sections: ['raw'] }), 'proj-1')?.sections
    ).toEqual(REPORT_SECTIONS)
  })

  test('a resolved scope exports exactly those pages; none or empty is the whole project', () => {
    const scoped = reportExportRequest(schedule({ format: 'pdf' }), 'proj-1', ['page-1', 'page-3'])
    expect(scoped).toMatchObject({ scope: 'selected', pageIds: ['page-1', 'page-3'] })
    expect(reportModelRequest(schedule({}), 'proj-1', ['topic-1'])).toMatchObject({
      scope: 'selected',
      pageIds: ['topic-1']
    })
    expect(reportModelRequest(schedule({}), 'proj-1', [])).toMatchObject({
      scope: 'project',
      pageIds: []
    })
    expect(reportModelRequest(schedule({}), 'proj-1', null)).toMatchObject({
      scope: 'project',
      pageIds: []
    })
  })
})

function schedule(overrides: Partial<ReportSchedule>): ReportSchedule {
  return {
    id: 'sched-1',
    name: 'Weekly',
    projectId: 'proj-1',
    timing: { kind: 'weekly', day: 1, time: '09:00' },
    format: 'pdf',
    sections: ['results', 'progress', 'raw'],
    marketIds: ['mkt-us'],
    recipients: ['owner@example.com'],
    accountId: null,
    timeZone: 'America/Toronto',
    subject: '{project}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides
  }
}
