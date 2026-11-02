import { buildReport } from '@shared/report/review'
import { describe, expect, test } from 'vitest'
import { sampleContext, sampleMetrics } from '../../../shared/report/review/sample.test-helper'
import { PANEL_JS } from '../html/client/panel'
import { htmlProblems, qualityMessage, reportProblems, visibleText } from './quality'

/**
 * The check a ready report passes before it is saved, and the drawer keeping each engine
 * view's rows apart.
 */

function page(sections: string, drills: Record<string, string[]> = {}): string {
  return (
    `<html><body><main>${sections}</main>` +
    `<script id="report-data" type="application/json">${JSON.stringify({ rows: [], drills })}</script>` +
    '<script>var x = undefined;</script></body></html>'
  )
}

function section(id: string, body: string): string {
  return `<section id="sec-${id}" class="report-section"><header class="sec-head"><h2>${id}</h2></header>${body}</section>`
}

describe('the export quality check', () => {
  test('a sound report passes', () => {
    const report = buildReport(sampleMetrics(), sampleContext())
    expect(reportProblems(report, 'all')).toEqual([])
    const html = page(
      section('verdict', '<p>Working <button class="drill" data-drill="all|gained">2</button></p>'),
      { 'all|gained': ['a', 'b'] }
    )
    expect(htmlProblems(html, [])).toEqual([])
  })

  test('blocks "[object …]", "undefined" and "NaN" in what the reader sees, not in scripts', () => {
    expect(visibleText('<p>a</p><script>var undefined</script><style>.NaN{}</style>')).toBe(' a ')
    const bad = page(
      section('verdict', '<p>[object HTMLButtonElement]</p><p>undefined questions</p><p>NaN%</p>')
    )
    const problems = htmlProblems(bad, [])
    expect(problems).toContain('The report shows “[object …]”.')
    expect(problems).toContain('The report shows “undefined”.')
    expect(problems).toContain('The report shows “NaN”.')
  })

  test('blocks an empty section and a number whose list is missing', () => {
    const html = page(
      section('verdict', '<p>Fine <button class="drill" data-drill="all|gone">3</button></p>') +
        section('deep', '<div class="card"> </div>')
    )
    const problems = htmlProblems(html, [])
    expect(problems).toContain('The “Deep dives” section is empty.')
    expect(problems.some((line) => line.includes('missing (all|gone)'))).toBe(true)
  })

  test('blocks numbers that do not add up', () => {
    const report = buildReport(sampleMetrics(), sampleContext())
    const broken = {
      ...report,
      verdict: {
        ...report.verdict,
        kpis: report.verdict.kpis.map((kpi, index) => (index === 0 ? { ...kpi, now: '999' } : kpi)),
        split: report.verdict.split && {
          ...report.verdict.split,
          workTenths: report.verdict.split.workTenths + 10
        }
      }
    }
    const problems = reportProblems(broken, 'chatgpt')
    expect(problems.some((line) => line.includes('shows 999 but its list has'))).toBe(true)
    expect(problems.some((line) => line.includes('do not add up'))).toBe(true)
    expect(problems.every((line) => line.includes('(chatgpt)'))).toBe(true)
  })

  test('the message is plain and says what to do', () => {
    const message = qualityMessage(['A', 'B', 'C', 'D', 'E'])
    expect(message.reason).toBe(
      'This report did not pass its check, so it was not saved. A B C And 2 more.'
    )
    expect(message.nextStep).toContain('Run a new check')
  })
})

interface Resolved {
  title: string
  html: string
  count: number
}

describe('the drawer keeps each engine view apart', () => {
  type Panel = (
    data: unknown,
    labelFor: (token: string) => string,
    viewNow?: () => string | null
  ) => { resolve: (entry: string) => Resolved | null; search: (q: string) => unknown[] }
  const CFPanel = new Function(`${PANEL_JS}return CFPanel;`)() as Panel
  const row = (view: string, id: string, engine: string, aio = true): Record<string, unknown> => ({
    id: `${view}|${id}`,
    number: 1,
    text: `Best SMS tool ${id}`,
    label: view,
    page: '/pricing',
    pageUrl: 'https://textbolt.com/pricing',
    market: 'US',
    stage: 'Decide',
    source: 'Pricing',
    status: 'Not cited',
    statusClass: 's-none',
    aio,
    cited: false,
    pageCited: false,
    named: false,
    position: null,
    checked: 'Oct 28',
    excerpt: null,
    domains: ['twilio.com'],
    refs: [[1, '', 'twilio.com', '', 'other']],
    view,
    engine
  })
  const data = {
    rows: [
      row('all', 'q1', 'all'),
      row('all', 'q2', 'all'),
      row('chatgpt', 'q1', 'chatgpt'),
      row('google_aio', 'q1', 'google_aio')
    ],
    drills: { 'chatgpt|lost': ['chatgpt|q1'], 'google_aio|lost': ['google_aio|q1'] }
  }
  let view: string | null = 'chatgpt'
  const panel = CFPanel(
    data,
    () => 'Lost',
    () => view
  )

  test('a site or page list opened in one view lists only that view’s rows', () => {
    expect(panel.resolve('dom:chatgpt|twilio.com')?.count).toBe(1)
    expect(panel.resolve('dom:all|twilio.com')?.count).toBe(2)
    expect(panel.resolve('p:all|https://textbolt.com/pricing')?.count).toBe(2)
    // A row's site chips point into its own view.
    expect(panel.resolve('q:chatgpt|q1')?.html).toContain('data-open="dom:chatgpt|twilio.com"')
  })

  test('search follows the engine on screen', () => {
    expect(panel.search('sms')).toHaveLength(1)
    view = 'all'
    expect(panel.search('sms')).toHaveLength(2)
  })

  test('the count strip says questions, and AI answer unless it is Google AI Overview', () => {
    const chatgpt = panel.resolve('l:chatgpt|lost')?.html ?? ''
    expect(chatgpt).toContain('>Questions<')
    expect(chatgpt).toContain('AI answer shown')
    expect(chatgpt).not.toContain('Prompts')
    expect(panel.resolve('l:google_aio|lost')?.html).toContain('AI Overview shown')
  })
})
