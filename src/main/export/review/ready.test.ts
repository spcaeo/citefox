import type { ReportDownloadRequest } from '@shared/ipc'
import { computeMetrics } from '@shared/metrics/compute'
import {
  buildReport,
  EMPTY_ANSWER_EXTRAS,
  EMPTY_EXTRAS,
  REPORT_TITLES,
  type ReportExtras,
  type ReportKind
} from '@shared/report/review'
import { describe, expect, test } from 'vitest'
import { sampleContext, sampleMetrics } from '../../../shared/report/review/sample.test-helper'
import { reviewDocumentHtml, type ReviewVariant } from './document'
import { parseDownloadRequest } from './download'
import { reviewCsv, type ReviewBuild } from './index'
import { htmlProblems, visibleText } from './quality'

/**
 * The short ready reports downloaded (Docs/REPORT-SPEC.md "Short ready reports"): each
 * draws the same sections as the app, passes the quality check (with data and with
 * none), the Content plan saves as CSV, and the download takes the rival from the request.
 */

const SITE = 'https://textbolt.com'

const EXTRAS: ReportExtras = {
  ...EMPTY_EXTRAS,
  questionTargets: { 'topic-1|q3': [`${SITE}/plans`], 'topic-1|q9': [`${SITE}/plans`] },
  answers: {
    ...EMPTY_ANSWER_EXTRAS,
    blocks: { 'google_aio:c3:q4': ['A1', 'C4'] },
    citations: {
      'google_aio:c3:q4': [
        {
          url: 'https://twilio.com/sms',
          domain: 'twilio.com',
          title: 'SMS',
          who: 'competitor',
          type: 'web'
        }
      ]
    }
  }
}

function variants(kind: ReportKind, rival?: string): ReviewVariant[] {
  return (['all', 'google_aio', 'chatgpt'] as const).map((engine) => {
    const metrics = sampleMetrics({ engine, from: null })
    return {
      view: engine,
      label: engine,
      report: buildReport(metrics, { ...sampleContext(kind), ...(rival ? { rival } : {}) }, EXTRAS),
      metrics
    }
  })
}

function html(kind: ReportKind, list: ReviewVariant[]): string {
  return reviewDocumentHtml({
    title: REPORT_TITLES[kind],
    domain: 'textbolt.com',
    scopeLabel: 'Whole project',
    marketLabel: 'United States · English',
    builtLabel: 'Nov 2',
    fileBase: `textbolt-${kind}`,
    variants: list
  })
}

describe('the downloaded short reports', () => {
  test('Pitch / audit: summary, short competitors, plan, method; passes its check', () => {
    const list = variants('pitch')
    const file = html('pitch', list)
    expect(htmlProblems(file, list)).toEqual([])
    const text = visibleText(file)
    for (const words of [
      'Summary',
      'The opportunity',
      'Most cited sites',
      'Top ten cited sites',
      'What we’d fix first',
      'How we measured'
    ]) {
      expect(text).toContain(words)
    }
    for (const step of list[0]!.report.ready.pitch.plan) expect(text).toContain(step.lead)
    // Short for the PDF: four sections, no every-site table.
    expect(file.match(/<section id="sec-/g)?.length).toBe(4)
    expect(text).not.toContain('Every cited site')
  })

  test('Content plan: rows with page, shape and sites; passes its check; CSV holds the briefs', () => {
    const list = variants('content')
    const file = html('content', list)
    expect(htmlProblems(file, list)).toEqual([])
    const text = visibleText(file)
    for (const words of [
      'Questions to win',
      'Page to write or fix',
      'New page',
      'Primary page',
      '/plans',
      'Answer shape',
      'Cited instead'
    ]) {
      expect(text).toContain(words)
    }
    const build = { report: list[1]!.report } as unknown as ReviewBuild
    const csv = reviewCsv(build, 'contentplan').split('\r\n').filter(Boolean)
    expect(csv[0]).toContain('Page to write or fix')
    const rows = list[1]!.report.ready.content.groups.flatMap((group) => group.rows)
    expect(csv.length).toBeGreaterThan(rows.length)
    expect(csv.join('\n')).toContain('Sites to beat')
  })

  test('Head-to-head: the rival from the request, tiles, table and their pages; passes its check', () => {
    const list = variants('rival', 'twilio.com')
    const file = html('rival', list)
    expect(htmlProblems(file, list)).toEqual([])
    const text = visibleText(file)
    for (const words of [
      'You against twilio.com',
      'twilio.com is cited on',
      'Only twilio.com: the gap',
      'Winner',
      'Their cited pages',
      '/sms'
    ]) {
      expect(text).toContain(words)
    }
  })

  test('an empty project still passes: each tab says what it needs', () => {
    const metrics = computeMetrics({
      rows: [],
      pages: [],
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      window: { from: null, to: null }
    })
    for (const kind of ['pitch', 'content', 'rival'] as const) {
      const list = [
        {
          view: 'all',
          label: 'All engines',
          report: buildReport(metrics, sampleContext(kind)),
          metrics
        }
      ]
      const file = html(kind, list)
      expect(htmlProblems(file, list)).toEqual([])
      expect(visibleText(file)).toContain('Needs a finished check.')
    }
  })

  test('the download request carries the rival', () => {
    const request: ReportDownloadRequest = {
      projectId: 'proj-1',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      from: null,
      to: null,
      report: 'rival',
      format: 'html',
      table: null,
      timeZone: 'America/Chicago'
    }
    expect(parseDownloadRequest({ ...request, rival: 'twilio.com' }).rival).toBe('twilio.com')
    expect(parseDownloadRequest(request).rival).toBeUndefined()
    expect(() => parseDownloadRequest({ ...request, rival: '<b>' })).toThrow()
    expect(
      parseDownloadRequest({ ...request, report: 'content', format: 'csv', table: 'contentplan' })
        .table
    ).toBe('contentplan')
  })
})
