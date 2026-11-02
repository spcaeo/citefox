import { buildReport, EMPTY_EXTRAS, type ReportExtras } from '@shared/report/review'
import { describe, expect, test } from 'vitest'
import { sampleContext, sampleMetrics } from '../../../shared/report/review/sample.test-helper'
import { visibilityCsvRows } from './csv-visibility'
import { reviewDocumentHtml, type ReviewVariant } from './document'
import { htmlProblems, visibleText } from './quality'

/**
 * The downloaded Visibility report shows the same new cards as the app (cover strip,
 * headline, opportunity, engines, target pages, topic universe, Reputation), passes the
 * quality check, and saves the new tables as CSV.
 */

const SITE = 'https://textbolt.com'

const EXTRAS: ReportExtras = {
  ...EMPTY_EXTRAS,
  visibility: {
    scopeLabel: 'Whole project',
    brands: ['TextBolt'],
    targets: {
      'topic-1|q1': [`${SITE}/email-to-sms-outlook`],
      'topic-1|q5': [`${SITE}/features`, `${SITE}/textbolt-for-schools`]
    },
    reputation: {
      brand: 'TextBolt',
      answers: 9,
      read: 9,
      claims: { positive: 4, neutral: 1, negative: 1 },
      rows: [
        {
          rowId: 'google_aio:c3:q2',
          tone: 'positive',
          theme: 'Setup',
          rank: '#1 of 2 brands named',
          reason: 'First.'
        }
      ],
      issues: [
        {
          id: 'c1',
          rowId: 'google_aio:c3:q2',
          question: '',
          claim: 'TextBolt has no trial.',
          brand: 'TextBolt',
          own: true,
          why: 'It has one.',
          correction: 'TextBolt has a 14-day trial.',
          sourceToFix: 'g2.com'
        }
      ],
      trend: [{ at: '2026-10-28T15:00:00.000Z', positive: 4, neutral: 1, negative: 1 }],
      themes: [
        {
          theme: 'Setup',
          positive: 2,
          neutral: 0,
          negative: 0,
          examples: [{ claim: 'Quick to set up.', tone: 'positive', rowId: 'google_aio:c3:q2' }]
        }
      ],
      brands: [
        {
          brand: 'TextBolt',
          own: true,
          rowIds: ['google_aio:c3:q2'],
          first: 1,
          positive: 4,
          neutral: 1,
          negative: 1
        },
        {
          brand: 'Twilio',
          own: false,
          rowIds: ['google_aio:c3:q2'],
          first: 0,
          positive: 1,
          neutral: 0,
          negative: 0
        }
      ]
    },
    since: null
  }
}

function variants(): ReviewVariant[] {
  return (['all', 'google_aio', 'chatgpt'] as const).map((engine) => {
    const metrics = sampleMetrics({ engine, from: null })
    return {
      view: engine,
      label: engine,
      report: buildReport(metrics, sampleContext('visibility'), EXTRAS),
      metrics
    }
  })
}

function html(list: ReviewVariant[]): string {
  return reviewDocumentHtml({
    title: 'Visibility report',
    domain: 'textbolt.com',
    scopeLabel: 'Whole project',
    marketLabel: 'United States · English',
    builtLabel: 'Nov 2',
    fileBase: 'textbolt-visibility',
    variants: list
  })
}

describe('the downloaded Visibility report', () => {
  test('shows the new cards and passes the quality check', () => {
    const list = variants()
    const file = html(list)
    const text = visibleText(file)
    for (const words of [
      'Brands looked for',
      'An AI answer shows for',
      'of tracked',
      'Cited and named',
      'The opportunity',
      'Reddit or YouTube beat you',
      'By engine',
      'Your target pages',
      'Other pages of yours being cited',
      'Topic groups',
      'Answer shown',
      'Brand named',
      'Net sentiment +50',
      'What AI says about you',
      'You next to your competitors',
      'Wrong claims worth correcting',
      'TextBolt has a 14-day trial.',
      'Answer by answer',
      'Tone per check',
      'See Reputation'
    ]) {
      expect(text).toContain(words)
    }
    expect(file).toContain('id="sec-reputation"')
    // The ChatGPT view says what Reputation needs instead of showing Google's tone.
    expect(text).toContain('Pick Google AI Overview or All engines')
    expect(htmlProblems(file, list)).toEqual([])
  })

  test('saves the target pages, other pages, wrong claims and answers as CSV', () => {
    const report = variants()[0]!.report
    const targets = visibilityCsvRows(report, 'targetpages')!
    expect(targets.header).toEqual([
      'Page',
      'Role',
      'Set for',
      'Google AI Overview',
      'ChatGPT',
      'Total',
      'Not cited yet'
    ])
    expect(targets.rows.length).toBe(report.visibility.targets.rows.length)
    expect(visibilityCsvRows(report, 'otherpages')!.rows.length).toBe(
      report.visibility.targets.others.length
    )
    expect(visibilityCsvRows(report, 'claims')!.rows[0]).toContain('TextBolt has a 14-day trial.')
    expect(visibilityCsvRows(report, 'answers')!.rows).toHaveLength(1)
    expect(visibilityCsvRows(report, 'questions')).toBeNull()
  })
})
