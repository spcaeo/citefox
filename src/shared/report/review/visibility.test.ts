import { describe, expect, test } from 'vitest'
import { reportHeadline } from '../../report-copy'
import { buildReport } from './build'
import { engineRowsOf } from './engine-rows'
import { EMPTY_EXTRAS, type ReportExtras } from './extras'
import { sampleContext, sampleMetrics } from './sample.test-helper'
import type { Num, ReviewReport } from './types'
import type { ReputationData, VisibilityExtras } from './visibility-extras'

/**
 * The Visibility report's own cards (visibility.ts, reputation.ts): every number opens a
 * list of exactly that size, the funnel only narrows, the opportunity bars never count a
 * question twice, target pages use each question's Primary + Also OK pages, and the
 * Reputation tab says what it needs when there is nothing to read.
 */

const SITE = 'https://textbolt.com'

const REPUTATION: ReputationData = {
  brand: 'TextBolt',
  answers: 9,
  read: 8,
  claims: { positive: 5, neutral: 2, negative: 1 },
  rows: [
    {
      rowId: 'google_aio:c3:q2',
      tone: 'positive',
      theme: 'Ease of setup',
      rank: '#1 of 3 brands named',
      reason: 'Listed first.'
    },
    { rowId: 'google_aio:c3:q4', tone: 'negative', theme: 'Pricing', rank: 'Named', reason: null },
    { rowId: 'google_aio:c9:q99', tone: 'positive', theme: null, rank: 'Named', reason: null }
  ],
  issues: [
    {
      id: 'claim-1',
      rowId: 'google_aio:c3:q4',
      question: 'stored text',
      claim: 'TextBolt has no free trial.',
      brand: 'TextBolt',
      own: true,
      why: 'The pricing page offers a 14-day trial.',
      correction: 'TextBolt has a 14-day free trial.',
      sourceToFix: 'g2.com'
    },
    {
      id: 'claim-2',
      rowId: null,
      question: 'What is TextBolt?',
      claim: 'TextBolt is a phone carrier.',
      brand: 'TextBolt',
      own: true,
      why: 'It is a software service.',
      correction: 'TextBolt is email-to-SMS software.',
      sourceToFix: null
    }
  ],
  trend: [
    { at: '2026-09-30T15:00:00.000Z', positive: 1, neutral: 1, negative: 0 },
    { at: '2026-10-28T15:00:00.000Z', positive: 5, neutral: 2, negative: 1 }
  ],
  themes: [
    {
      theme: 'Ease of setup',
      positive: 3,
      neutral: 0,
      negative: 0,
      examples: [{ claim: 'Setup takes minutes.', tone: 'positive', rowId: 'google_aio:c3:q2' }]
    }
  ],
  brands: [
    {
      brand: 'TextBolt',
      own: true,
      rowIds: ['google_aio:c3:q2', 'google_aio:c3:q4'],
      first: 1,
      positive: 5,
      neutral: 2,
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
}

function extrasWith(visibility: Partial<VisibilityExtras> = {}): ReportExtras {
  return {
    ...EMPTY_EXTRAS,
    visibility: {
      scopeLabel: 'Topic: Email to SMS',
      brands: ['TextBolt', 'Text Bolt'],
      targets: {
        'topic-1|q1': [`${SITE}/email-to-sms-outlook`],
        'topic-1|q2': [`${SITE}/email-to-sms-outlook`],
        'topic-1|q4': [`${SITE}/features`],
        'topic-1|q5': [`${SITE}/features`, `${SITE}/textbolt-for-schools`],
        'topic-1|q7': [`${SITE}/textbolt-for-schools`]
      },
      reputation: REPUTATION,
      since: null,
      ...visibility
    }
  }
}

function visibility(
  engine: 'all' | 'google_aio' | 'chatgpt' = 'all',
  extras: ReportExtras = extrasWith()
): ReviewReport {
  return buildReport(sampleMetrics({ engine, from: null }), sampleContext('visibility'), extras)
}

function listed(report: ReviewReport, num: Num): number {
  return report.drills[num.drill]?.ids.length ?? -1
}

describe('Visibility report: Where you stand', () => {
  test('the cover strip names scope, market, brands, questions × topics, target pages and window', () => {
    const report = visibility()
    const facts = Object.fromEntries(report.visibility.cover.map((f) => [f.label, f.value]))
    expect(facts.Scope).toBe('Topic: Email to SMS')
    expect(facts.Market).toBe('United States · English')
    expect(facts['Brands looked for']).toBe('TextBolt, Text Bolt')
    expect(facts.Questions).toBe('12 questions × 3 topics')
    expect(facts['Target pages set']).toBe('5 of 12 questions')
    expect(facts['Data window']).toBe('Sep 16 → Oct 28 · 3 checks')
    for (const fact of report.visibility.cover) {
      if (fact.num) expect(listed(report, fact.num)).toBe(fact.num.n)
    }
  })

  test('the headline is the Full report sentence, each number opening its questions', () => {
    const report = visibility('google_aio')
    const parts = report.visibility.headline
    const text = parts.map((p) => (typeof p === 'string' ? p : String(p.n))).join('')
    const now = sampleMetrics({ engine: 'google_aio', from: null }).now
    expect(text).toBe(
      reportHeadline({
        measured: now.measured.n,
        aio: now.answered.n,
        cited: now.cited.n,
        named: now.named.n,
        notVisible: now.notVisible.n,
        failed: now.failed.n,
        noun: 'buyer questions across your pages'
      })
    )
    const nums = parts.filter((p): p is Num => typeof p !== 'string')
    expect(nums.length).toBeGreaterThanOrEqual(4)
    for (const num of nums) expect(listed(report, num)).toBe(num.n)
    expect(visibility('chatgpt').visibility.headline[0]).toContain('ChatGPT shows an AI answer')
  })

  test('a share line sits under each tile', () => {
    const report = visibility()
    expect(report.visibility.kpiNotes).toHaveLength(report.standing.kpis.length)
    expect(report.visibility.kpiNotes[1]).toMatch(/^\d+% of tracked$/)
    expect(report.visibility.kpiNotes[2]).toMatch(/^\d+% of answers$/)
  })

  test('the funnel only narrows: its last step is cited and named', () => {
    const report = visibility()
    const steps = report.standing.funnel
    expect(steps.at(-1)?.label).toBe('Cited and named')
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!.value).toBeLessThanOrEqual(steps[i - 1]!.value)
    }
    const last = report.drills[steps.at(-1)!.drill]!.ids
    const cited = new Set(report.drills['now:cited']!.ids)
    const named = new Set(report.drills['now:named']!.ids)
    expect(last.every((id) => cited.has(id) && named.has(id))).toBe(true)
  })

  test('the opportunity bars never count a question twice and fit inside the answers', () => {
    const report = visibility()
    const { opportunity } = report.visibility
    const ids = opportunity.bars.flatMap((bar) => report.drills[bar.value.drill]!.ids)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length + opportunity.rest).toBe(opportunity.answers.n)
    expect(opportunity.bars.map((bar) => bar.id)).toEqual([
      'invisible',
      'wrongpage',
      'ugc',
      'winning'
    ])
    // Wrong page is the "other own page" result: cited, but not the question's target.
    const metrics = sampleMetrics({ engine: 'all', from: null })
    for (const id of report.drills['vis:opp:wrongpage']!.ids) {
      expect(metrics.rows[id]?.result).toBe('other')
    }
  })

  test('By engine lists each engine under All engines, and says to pick All under one', () => {
    const all = visibility().visibility.engines
    expect(all.rows.map((row) => row.engine)).toEqual(['google_aio', 'chatgpt'])
    const report = visibility()
    for (const row of all.rows) {
      for (const num of [row.answered, row.cited, row.right, row.named]) {
        expect(listed(report, num)).toBe(num.n)
      }
      expect(row.right.n).toBeLessThanOrEqual(row.cited.n)
    }
    const one = visibility('chatgpt').visibility.engines
    expect(one.rows).toEqual([])
    expect(one.note).toContain('Pick All engines')
  })

  test('since the previous check: hidden without data, filtered to this report’s questions', () => {
    expect(visibility().visibility.since).toBeNull()
    const metrics = sampleMetrics({ engine: 'google_aio', from: null })
    const [first, second] = metrics.now.checked.ids
    const report = buildReport(
      metrics,
      sampleContext('visibility'),
      extrasWith({
        since: {
          fromAt: '2026-09-30T15:00:00.000Z',
          gained: [first!, 'gone'],
          lost: [],
          newlyNamed: [second!],
          noLongerNamed: []
        }
      })
    )
    const since = report.visibility.since!
    expect(since.fromLabel).toBe('Sep 30')
    expect(since.gained.n).toBe(1)
    expect(since.newlyNamed.n).toBe(1)
    expect(listed(report, since.gained)).toBe(1)
  })
})

describe('Visibility report: Your pages', () => {
  test('tiles and the table come from the Primary + Also OK pages', () => {
    const report = visibility()
    const t = report.visibility.targets
    expect(t.set?.n.n).toBe(5)
    const labels = Object.fromEntries(t.tiles.map((tile) => [tile.label, tile.value]))
    expect(labels['Target pages set up']).toBe('3')
    const schools = t.rows.find((row) => row.path === '/textbolt-for-schools')!
    expect(schools.role).toBe('Primary · Also OK')
    expect(schools.notCited).toBe(true)
    const features = t.rows.find((row) => row.path === '/features')!
    expect(features.engines).toHaveLength(t.engines.length)
    expect(t.engines.map((e) => e.id)).toEqual(['google_aio', 'chatgpt'])
    expect(features.total.n).toBeGreaterThan(0)
    for (const row of t.rows) {
      for (const num of [row.questions, row.total, ...row.engines]) {
        expect(listed(report, num)).toBe(num.n)
      }
    }
    // /pricing is cited but is no question's target: it is an "other page of yours".
    expect(t.others.map((row) => row.path)).toContain('/pricing')
    expect(labels['Other pages of yours cited']).toBe(String(t.others.length))
    // Every page a tile lists opens in the page drawer.
    for (const url of report.drills['vis:tp:all']!.ids) {
      expect(report.pagesByUrl[url]).toBeDefined()
    }
  })

  test('without target data the tab says what it needs', () => {
    const report = buildReport(
      sampleMetrics({ engine: 'all', from: null }),
      sampleContext('visibility'),
      EMPTY_EXTRAS
    )
    expect(report.visibility.targets.tiles).toEqual([])
    expect(report.visibility.targets.empty).toContain('No target pages set yet')
    expect(report.visibility.cover.some((f) => f.label === 'Target pages set')).toBe(false)
  })
})

describe('Visibility report: Topics', () => {
  test('universe tiles judge best and weakest only from groups of 5+', () => {
    const report = visibility()
    const tiles = report.visibility.topics.universe.topic
    expect(tiles[0]).toMatchObject({ label: 'Topic groups', value: '3' })
    expect(tiles[1]?.value).toBe('Email to SMS basics')
    expect(tiles[2]?.value).toBe('Email to SMS basics')
    // Only one group has 5+ questions, so there is no weakest.
    expect(tiles[3]?.value).toBe('—')
  })

  test('answer shown and brand named per segment, and small groups are flagged', () => {
    const report = visibility()
    const rows = report.visibility.topics.rows.topic
    const compliance = rows.Compliance!
    expect(compliance.flag).toBe('small')
    expect(rows['Email to SMS basics']?.flag).toBeNull()
    for (const add of Object.values(rows)) {
      expect(listed(report, add.answered)).toBe(add.answered.n)
      expect(listed(report, add.named)).toBe(add.named.n)
      expect(add.bar).toBeGreaterThanOrEqual(0)
      expect(add.bar).toBeLessThanOrEqual(100)
    }
  })
})

describe('Visibility report: Reputation', () => {
  test('leads with net sentiment, the split, themes and competitors', () => {
    const report = visibility('google_aio')
    const r = report.visibility.reputation
    expect(r.needs).toBeNull()
    expect(r.claims.net).toBe(50)
    expect(r.standingLine).toBe(
      'Net sentiment +50 from 8 claims about TextBolt: 5 positive, 2 neutral, 1 negative.'
    )
    // The answer from another check (c9) is not in this report and is left out.
    expect(r.rows).toHaveLength(2)
    const positive = r.split.find((slice) => slice.tone === 'positive')!
    expect(positive.value.n).toBe(1)
    expect(report.drills[positive.value.drill]!.ids).toEqual([r.rows[0]!.question.id])
    expect(r.themes[0]).toMatchObject({ theme: 'Ease of setup', total: 3 })
    expect(r.themes[0]!.examples[0]!.question?.id).toBe(r.rows[0]!.question.id)
    expect(r.brands.map((b) => b.brand)).toEqual(['TextBolt', 'Twilio'])
    expect(r.brands[0]!.answers.n).toBe(2)
    expect(r.issues[0]).toMatchObject({
      correction: 'TextBolt has a 14-day free trial.',
      sourceToFix: 'g2.com'
    })
    expect(r.issues[0]!.question).not.toBeNull()
    expect(r.issues[1]).toMatchObject({ question: null, questionText: 'What is TextBolt?' })
    expect(r.trend.map((p) => p.label)).toEqual(['Sep 30', 'Oct 28'])
  })

  test('under All engines it maps the Google answers to the merged questions', () => {
    const report = visibility('all')
    const metrics = sampleMetrics({ engine: 'all', from: null })
    const r = report.visibility.reputation
    expect(r.rows).toHaveLength(2)
    for (const row of r.rows) {
      expect(
        engineRowsOf(metrics, row.question.id).some((part) => part.engine === 'google_aio')
      ).toBe(true)
    }
  })

  test('says plainly what it needs', () => {
    expect(visibility('chatgpt').visibility.reputation.needs).toContain('Pick Google AI Overview')
    const none = visibility('all', extrasWith({ reputation: null })).visibility.reputation
    expect(none.needs).toContain('Needs a check with Google AI Overview answers')
    expect(none.standingLine).toBeNull()
    const unread = visibility('all', extrasWith({ reputation: { ...REPUTATION, read: 0 } }))
    expect(unread.visibility.reputation.needs).toContain('has not read')
  })

  test('the Visibility report has a Reputation tab', () => {
    expect(visibility().sections.map((s) => s.id)).toContain('reputation')
  })
})
