import { describe, expect, test } from 'vitest'
import { sampleReportModel } from '../../export/model/sample.test-helper'
import { reportSummaryLines } from './summary-body'

describe('scheduled report email body', () => {
  test('headline, score and change, what changed, what to do next and the attachment', () => {
    const model = sampleReportModel({ marketIds: ['mkt-us'] })
    const lines = reportSummaryLines(model, 'html_link')
    const text = lines.join('\n')
    // The one-sentence headline comes first after the title and scope, alone.
    expect(lines[3]).toBe(model.headline)
    expect(text).not.toContain(model.overview.headline)
    expect(text).toMatch(
      /Visibility score: \d+ of 100, (up|down) \d+ since the previous full check on 5 October 2026\./
    )
    expect(text).toContain(`- Gained citations: ${model.trends.gained.count.n}`)
    expect(text).toContain('(Not cited → Target page #2)')
    expect(model.recommendations.length).toBeGreaterThan(0)
    expect(text).toContain('What to do next:')
    model.recommendations.forEach((item, index) => {
      expect(text).toContain(`${index + 1}. ${item.doThis}\n   Why: ${item.why}`)
    })
    expect(text).not.toContain('Top 3 actions')
    expect(text).toContain('Attached: Interactive HTML report (.zip')
    expect(text).not.toMatch(/HTML link|AI Mode/)
    expect(text.endsWith('Change or stop this report in CiteFox › Reports.')).toBe(true)
    expect(text).not.toContain('Settings ›')
  })

  test('without evidence for a recommendation, the stored top actions are listed', () => {
    const model = { ...sampleReportModel({ marketIds: ['mkt-us'] }), recommendations: [] }
    const text = reportSummaryLines(model, 'pdf').join('\n')
    expect(text).toContain('What to do next:\n1. Add a Verizon vtext.com shutdown FAQ — ')
    expect(text).toContain('3. Add a head-to-head Twilio comparison')
  })

  test('summary-only schedules say nothing is attached; no previous check says so', () => {
    const model = sampleReportModel({ checks: 'latest', scope: 'project', pageIds: [] })
    const text = reportSummaryLines(model, 'summary').join('\n')
    expect(text).toContain('No file is attached: this schedule sends the summary only.')
  })

  test('who the reports are from (Settings › Reports) signs the email; none: no line', () => {
    const model = sampleReportModel({ marketIds: ['mkt-us'] })
    const signed = reportSummaryLines(model, 'pdf', 'Northwind SEO')
    const at = signed.indexOf('Prepared by Northwind SEO')
    expect(at).toBeGreaterThan(0)
    expect(signed[at + 1]).toBe('Built with CiteFox')
    expect(reportSummaryLines(model, 'pdf').join('\n')).not.toContain('Prepared by')
  })

  test('every count in the body matches the report model', () => {
    const model = sampleReportModel()
    const text = reportSummaryLines(model, 'pdf').join('\n')
    for (const list of [model.trends.lost, model.trends.newlyNamed, model.trends.noLongerNamed]) {
      if (list.count.n > 0) expect(text).toContain(`: ${list.count.n}\n`)
    }
    expect(text).toContain('Attached: PDF report.')
  })
})
