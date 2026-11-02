import { buildReport, EMPTY_EXTRAS, type ReportExtras } from '@shared/report/review'
import { computeMetrics } from '@shared/metrics'
import { describe, expect, test } from 'vitest'
import {
  sampleContext,
  sampleMetrics,
  sampleRows
} from '../../../shared/report/review/sample.test-helper'
import { reviewDocumentHtml } from './document'
import { htmlProblems, visibleText } from './quality'

/**
 * The downloaded Impact review carries the same extra parts as the app (intro, proofs,
 * published tables, page stories, client asks, method checks) and little data, and still
 * passes the quality check.
 */

const EXTRAS: ReportExtras = {
  ...EMPTY_EXTRAS,
  backlinks: [
    {
      url: 'https://textbolt.com/textbolt-for-schools',
      title: 'TextBolt for schools',
      priority: 'first',
      reason: 'Not indexed',
      anchor: 'TextBolt for schools',
      anchorSaved: false,
      daysLive: 5
    }
  ],
  changes: {
    'https://textbolt.com/features': {
      url: 'https://textbolt.com/features',
      changedAt: '2026-10-10T00:00:00.000Z',
      sectionsAdded: 0,
      sectionsRemoved: 1,
      headingsChanged: 0,
      textChanged: 0,
      sections: ['Pricing'],
      wordsBefore: null,
      wordsAfter: null,
      outlineBefore: [
        { level: 2, text: 'Send email to SMS' },
        { level: 2, text: 'Pricing' }
      ],
      outlineAfter: [{ level: 2, text: 'Send email to SMS' }]
    }
  }
}

function html(
  report: ReturnType<typeof buildReport>,
  metrics: ReturnType<typeof sampleMetrics>
): string {
  return reviewDocumentHtml({
    title: report.title,
    domain: 'textbolt.com',
    scopeLabel: 'Whole project',
    marketLabel: 'US · EN',
    builtLabel: 'Nov 2',
    fileBase: 'textbolt-impact',
    variants: [{ view: 'all', label: 'All engines', report, metrics }]
  })
}

describe('downloaded Impact review extras', () => {
  test('carries the intro, proofs, tables, stories and client asks, and passes its check', () => {
    const metrics = sampleMetrics()
    const report = buildReport(metrics, sampleContext('impact'), EXTRAS)
    const file = html(report, metrics)
    const text = visibleText(file)
    for (const words of [
      'About these results: answers vary.',
      '12 questions · 3 pages published · measured Sep 16 and Oct 28',
      'came through your published pages',
      'Most cited sites',
      'New pages and rewrites',
      'By days live',
      'Each page, before and after',
      'Why it is not cited yet',
      'Still citing it',
      'How to add the links',
      'Tell us when links go live.',
      'The next round has already started',
      'Round 3 started Oct 28',
      'Questions not cited yet, by topic',
      'What your team does',
      'URL Inspection',
      'Questions written for it',
      'A clean before',
      'publishing records'
    ]) {
      expect(text).toContain(words)
    }
    expect(file).toContain('class="rv-outline-dropped')
    expect(file).toContain('href="#sec-lost"')
    expect(htmlProblems(file, [{ view: 'all', label: 'All engines', report, metrics }])).toEqual([])
  })

  test('with no fixes and one check: what it needs, no hidden tabs, greyed tabs say why', () => {
    const metrics = computeMetrics({
      rows: sampleRows().filter((row) => row.checkId === 'c3'),
      pages: [],
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      window: { from: '2026-10-28T15:00:00.000Z', to: null }
    })
    const report = buildReport(metrics, sampleContext('impact'), EMPTY_EXTRAS)
    const file = html(report, metrics)
    const text = visibleText(file)
    expect(text).toContain('What this report needs')
    expect(text).toContain('Log the pages you published or rewrote')
    expect(text).toContain('Nothing to show yet. Needs a logged fix')
    expect(file).not.toContain('id="sec-lost"')
    expect(file).not.toContain('id="sec-notindexed"')
    expect(text).not.toContain('How fast new pages get cited')
    expect(htmlProblems(file, [{ view: 'all', label: 'All engines', report, metrics }])).toEqual([])
  })
})
