import { computeMetrics } from '@shared/metrics'
import { buildReport, EMPTY_EXTRAS, type ReviewReport } from '@shared/report/review'
import { describe, expect, test } from 'vitest'
import {
  sampleContext,
  sampleMetrics,
  samplePages,
  sampleRows
} from '../../../shared/report/review/sample.test-helper'
import { reviewDocumentHtml } from './document'
import { htmlProblems, reportProblems, visibleText } from './quality'

/**
 * The downloaded What changed report: the same parts as the app (cover, the four lists,
 * coverage, split table, changed pages, answer structure, named share per lens), and the
 * one-check panel; both pass the quality check.
 */

function html(report: ReviewReport): string {
  return reviewDocumentHtml({
    title: 'What changed',
    domain: 'textbolt.com',
    scopeLabel: 'Whole project',
    marketLabel: 'US · EN',
    builtLabel: 'Nov 2',
    fileBase: 'textbolt-what-changed',
    variants: [{ view: 'all', label: 'All engines', report, metrics: sampleMetrics() }]
  })
}

describe('downloaded What changed', () => {
  test('shows the What changed parts and passes the quality check', () => {
    const report = buildReport(sampleMetrics(), sampleContext('changed'), {
      ...EMPTY_EXTRAS,
      blocks: { 'google_aio:c1:q1': ['A1'], 'google_aio:c3:q1': ['C4', 'A1'] },
      blockLabels: { A1: 'What / Definition', C4: 'How / Procedural' },
      claims: {
        'google_aio:c3:q4': [{ polarity: 'negative', sentence: 'No free plan.', theme: 'Pricing' }]
      }
    })
    const file = html(report)
    const variants = [{ view: 'all', label: 'All engines', report, metrics: sampleMetrics() }]
    expect(reportProblems(report, 'all')).toEqual([])
    expect(htmlProblems(file, variants)).toEqual([])
    const text = visibleText(file)
    for (const words of [
      'Every number covers the',
      'Which questions moved',
      'Newly named',
      'No longer named',
      'What this comparison covers',
      'From more answers',
      'Brand named',
      'What the verdict is based on',
      'Pages changed in this window',
      'questions vs the rest of the project',
      'Which answer blocks gained ground',
      'Answers that changed shape',
      'Named share',
      'How AI talks about you',
      'No free plan.'
    ]) {
      expect(text, words).toContain(words)
    }
    expect(file).toContain('id="sec-pages"')
    expect(file).toContain('id="sec-published"')
  })

  test('with one check, shows one panel that needs a second check', () => {
    const metrics = computeMetrics({
      rows: sampleRows().filter((row) => row.checkId === 'c1'),
      pages: samplePages(),
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      window: { from: '2026-09-16T15:00:00.000Z', to: null }
    })
    const report = buildReport(metrics, sampleContext('changed'), EMPTY_EXTRAS)
    const file = html(report)
    expect(htmlProblems(file, [{ view: 'all', label: 'All engines', report, metrics }])).toEqual([])
    const text = visibleText(file)
    expect(text).toContain('What changed needs a second check')
    expect(text).toContain('No check is scheduled yet')
    expect(file.match(/<section id="sec-/g)?.length).toBe(1)
  })
})
