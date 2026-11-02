import { buildReport, EMPTY_EXTRAS } from '@shared/report/review'
import { describe, expect, test } from 'vitest'
import { sampleContext, sampleMetrics } from '../../../shared/report/review/sample.test-helper'
import { reviewDocumentHtml } from './document'
import { groupedSections, navHtml } from './nav'
import { htmlProblems } from './quality'

/** The downloaded report's side nav follows the app's grouped tabs; numbers stay the same. */
describe('downloaded report: grouped section nav', () => {
  test('Impact review: groups as headings with their sections under them, body in tab order', () => {
    const metrics = sampleMetrics()
    const report = buildReport(metrics, sampleContext('impact'), EMPTY_EXTRAS)
    const nav = navHtml(report)
    expect(nav).toContain(
      '<li><a href="#sec-notindexed" data-target="sec-notindexed" data-level="1">Client asks</a><ol>'
    )
    expect(nav).toContain('data-target="sec-backlinks" data-level="2">Backlinks</a>')
    expect(nav).toContain('data-target="sec-verdict" data-level="1">Verdict</a>')
    const order = groupedSections(report).map((entry) => entry.id)
    expect(order.slice(-4)).toEqual(['changed', 'topics', 'deep', 'method'])
    expect([...order].sort()).toEqual(report.sections.map((entry) => entry.id).sort())
    const file = reviewDocumentHtml({
      title: report.title,
      domain: 'textbolt.com',
      scopeLabel: 'Whole project',
      marketLabel: 'US · EN',
      builtLabel: 'Nov 2',
      fileBase: 'textbolt-impact',
      variants: [{ view: 'all', label: 'All engines', report, metrics }]
    })
    expect(file.indexOf('id="sec-changed"')).toBeGreaterThan(file.indexOf('id="sec-next"'))
    expect(htmlProblems(file, [{ view: 'all', label: 'All engines', report, metrics }])).toEqual([])
  })

  test('a report with 7 or fewer sections keeps a flat nav', () => {
    const metrics = sampleMetrics()
    const report = buildReport(metrics, sampleContext('impact'), EMPTY_EXTRAS)
    const short = { ...report, sections: report.sections.slice(0, 4) }
    expect(navHtml(short)).not.toContain('data-level="2"')
  })
})
