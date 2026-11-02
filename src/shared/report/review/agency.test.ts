import { describe, expect, it } from 'vitest'
import { buildReport } from './build'
import {
  answerShape,
  cleanBranding,
  EMPTY_EXTRAS,
  overviewShape,
  suggestAnchor,
  type AnswerShape,
  type ReportExtras
} from './extras'
import { changeLine } from './agency'
import { sampleContext, sampleMetrics } from './sample.test-helper'
import type { ReviewReport } from './types'

function counted(report: ReviewReport, n: number, drill: string): void {
  expect(report.drills[drill]?.ids.length, drill).toBe(n)
}

describe('answer shapes from stored text', () => {
  it('reads lists, steps, tables and length', () => {
    expect(answerShape(null)).toBeNull()
    expect(answerShape('   ')).toBeNull()
    expect(answerShape('One plain sentence with five words.')).toEqual({
      words: 6,
      list: false,
      steps: false,
      table: false
    })
    const steps = answerShape('How to do it:\n1. Open Outlook\n2. Add the number\n3. Send')
    expect(steps).toMatchObject({ list: true, steps: true, table: false })
    const bullets = answerShape('Options:\n- TextBolt\n- Twilio\n* SimpleTexting')
    expect(bullets).toMatchObject({ list: true, steps: false })
    const table = answerShape(
      '| Tool | Price |\n| --- | --- |\n| TextBolt | $10 |\n| Twilio | $20 |'
    )
    expect(table).toMatchObject({ table: true })
  })

  it("reads a Google AI Overview's lists, steps and tables from its stored blocks", () => {
    const raw = JSON.stringify({
      ai_overview: {
        text_blocks: [
          { type: 'paragraph', snippet: 'Three ways to text staff.' },
          { type: 'list', list: [{ snippet: '1. Open Outlook' }, { snippet: '2. Send' }] },
          {
            type: 'table',
            table: [
              ['Tool', 'Price'],
              ['TextBolt', '$10']
            ]
          }
        ]
      }
    })
    expect(overviewShape(raw, 'Three ways to text staff. 1. Open Outlook 2. Send')).toEqual({
      words: 10,
      list: true,
      steps: true,
      table: true
    })
    expect(overviewShape('not json', 'Plain words here')).toMatchObject({ list: false, words: 3 })
    expect(overviewShape(null, null)).toBeNull()
  })

  it('suggests an anchor from the title, else the address', () => {
    expect(suggestAnchor('https://textbolt.com/pricing', 'Pricing | TextBolt')).toBe('Pricing')
    expect(suggestAnchor('https://textbolt.com/email-to-sms-outlook', null)).toBe(
      'Email to sms outlook'
    )
    expect(suggestAnchor('https://textbolt.com/', null)).toBe('home page')
  })

  it('keeps a clean "Prepared for" line and drops anything that is not a small image', () => {
    expect(cleanBranding({ preparedFor: '  Acme   Inc. ', logo: 'javascript:alert(1)' })).toEqual({
      preparedFor: 'Acme Inc.',
      logo: null
    })
    expect(cleanBranding({ preparedFor: 'x'.repeat(200), logo: null }).preparedFor).toHaveLength(80)
    expect(cleanBranding({ preparedFor: '', logo: 'data:image/png;base64,AAAA' }).logo).toBe(
      'data:image/png;base64,AAAA'
    )
    expect(cleanBranding(null)).toEqual({ preparedFor: '', logo: null })
  })

  it('says what changed on a page in one line', () => {
    expect(
      changeLine({
        url: 'https://textbolt.com/features',
        changedAt: '2026-10-06T00:00:00.000Z',
        sectionsAdded: 0,
        sectionsRemoved: 1,
        headingsChanged: 2,
        textChanged: 0,
        sections: ['Pricing'],
        wordsBefore: 1240,
        wordsAfter: 860
      })
    ).toBe('1 section removed, 2 headings reworded, 1,240 → 860 words.')
  })
})

describe('agency sections and deep dives', () => {
  const metrics = sampleMetrics()
  const shapes: Record<string, AnswerShape> = {}
  for (const row of Object.values(metrics.rows)) {
    if (row.engine === 'all') continue
    const n = Number(row.questionId.replace(/\D/g, '')) || 0
    shapes[row.id] = { words: 80 + n * 20, list: n % 2 === 0, steps: n % 3 === 0, table: n === 4 }
  }
  const extras: ReportExtras = {
    ...EMPTY_EXTRAS,
    shapes,
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
        changedAt: '2026-10-06T00:00:00.000Z',
        sectionsAdded: 0,
        sectionsRemoved: 1,
        headingsChanged: 1,
        textChanged: 2,
        sections: ['Pricing table'],
        wordsBefore: 1200,
        wordsAfter: 900
      }
    },
    owners: [{ step: 'publish', owner: 'Dana' }],
    nextCheckAt: '2026-11-11T15:00:00.000Z',
    intervalDays: 14,
    branding: { preparedFor: 'Acme Inc.', logo: null }
  }
  const report = buildReport(metrics, sampleContext(), extras)

  it('Lost ground: what changed, where each lost question went, a recovery plan', () => {
    const item = report.lostGround.items.find((entry) => entry.page.path === '/features')
    expect(item).toBeDefined()
    if (!item) return
    expect(item.lost.n).toBe(item.questions.length)
    expect(item.toOwn.n + item.toOthers.n + item.noAnswer.n).toBe(item.lost.n)
    counted(report, item.toOthers.n, item.toOthers.drill)
    expect(item.change?.sections).toEqual(['Pricing table'])
    expect(item.changedLabel).toBe('Oct 6')
    expect(item.plan.join(' ')).toContain('Pricing table')
    expect(report.sections.find((s) => s.id === 'lost')?.alert).toBe(true)
  })

  it('Backlinks and the 5-step cycle with owners; every count drills', () => {
    expect(report.backlinks.first).toBe(1)
    expect(report.round.steps.map((step) => step.name)).toEqual([
      'Measure',
      'Re-optimise',
      'Publish',
      'Get indexed',
      'Build backlinks'
    ])
    expect(report.round.steps.find((step) => step.step === 'publish')?.owner).toBe('Dana')
    expect(report.round.steps.find((step) => step.step === 'measure')?.owner).toBe('CiteFox')
    for (const step of report.round.steps) {
      if (step.count) counted(report, step.count.n, step.count.drill)
    }
    expect(report.round.schedule).toBe('Next check on Nov 11, then every 14 days.')
    expect(report.branding.preparedFor).toBe('Acme Inc.')
  })

  it('Deep dives: answer shapes before and now, position spread, engines agreeing', () => {
    const shapesView = report.deep.shapes
    expect(shapesView).not.toBeNull()
    for (const item of shapesView?.items ?? []) {
      counted(report, item.now, item.nowDrill)
      if (item.beforeDrill) counted(report, item.before, item.beforeDrill)
    }
    expect(shapesView?.wordsNow).toBeGreaterThan(0)
    const spread = report.deep.spread
    expect(spread.map((bar) => bar.label)).toEqual([
      'Source #1',
      'Source #2',
      'Source #3',
      'Source #4–5',
      'Source #6 or lower'
    ])
    expect(spread.reduce((sum, bar) => sum + bar.now, 0)).toBe(
      report.drills['now:cited']?.ids.length ?? metrics.now.cited.n
    )
    const agree = report.deep.agree
    expect(agree?.engines).toBe(2)
    expect(agree?.buckets.map((bucket) => bucket.label)).toEqual([
      'No engine',
      '1 engine',
      'All 2 engines'
    ])
    for (const bucket of agree?.buckets ?? []) counted(report, bucket.value, bucket.drill)
  })

  it('one engine: no agreement view; no stored text: no shapes', () => {
    const one = buildReport(sampleMetrics({ engine: 'chatgpt' }), sampleContext())
    expect(one.deep.agree).toBeNull()
    expect(one.deep.shapes).toBeNull()
    expect(one.engine).toBe('chatgpt')
  })

  it('How we measured says answers vary, with the noise band', () => {
    const text = report.method.paragraphs.join(' ')
    expect(text).toContain('Answers vary')
    expect(report.method.noise).toBe(Math.max(1, Math.ceil(report.method.compared.n * 0.05)))
  })
})
