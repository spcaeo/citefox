import { computeMetrics } from '../../metrics/compute'
import type { MetricPage, MetricResult, MetricRow, MetricsResult } from '../../metrics/types'
import type { ReportContext, ReportKind } from './types'

/**
 * A small made-up TextBolt project for the ready-report tests: 12 questions in two
 * topics, checked on Sep 16, Sep 30 and Oct 28 on Google, and on ChatGPT in the last
 * two checks; three published pages (one too new, one not indexed, one lost ground).
 */

const CHECKS = [
  ['c1', '2026-09-16T15:00:00.000Z'],
  ['c2', '2026-09-30T15:00:00.000Z'],
  ['c3', '2026-10-28T15:00:00.000Z']
] as const

const SITE = 'https://textbolt.com'
const OUTLOOK = `${SITE}/email-to-sms-outlook`
const PRICING = `${SITE}/pricing`
const FEATURES = `${SITE}/features`
const SCHOOLS = `${SITE}/textbolt-for-schools`

type Plan = readonly [MetricResult, string | null, number | null]

/** Each question's Google result per check: result, cited page, position. */
const GOOGLE: Readonly<Record<string, readonly Plan[]>> = {
  q1: [
    ['not_cited', null, null],
    ['not_cited', null, null],
    ['target', OUTLOOK, 1]
  ],
  q2: [
    ['no_answer', null, null],
    ['not_cited', null, null],
    ['target', OUTLOOK, 2]
  ],
  q3: [
    ['other', PRICING, 3],
    ['other', PRICING, 3],
    ['other', PRICING, 2]
  ],
  q4: [
    ['target', FEATURES, 2],
    ['target', FEATURES, 2],
    ['not_cited', null, null]
  ],
  q5: [
    ['target', FEATURES, 1],
    ['target', FEATURES, 1],
    ['not_cited', null, null]
  ],
  q6: [
    ['target', FEATURES, 3],
    ['not_cited', null, null],
    ['not_cited', null, null]
  ],
  q7: [
    ['no_answer', null, null],
    ['no_answer', null, null],
    ['no_answer', null, null]
  ],
  q8: [
    ['not_cited', null, null],
    ['not_cited', null, null],
    ['not_cited', null, null]
  ],
  q9: [
    ['not_cited', null, null],
    ['other', PRICING, 4],
    ['other', PRICING, 4]
  ],
  q10: [
    ['no_answer', null, null],
    ['no_answer', null, null],
    ['not_cited', null, null]
  ],
  q11: [
    ['not_cited', null, null],
    ['failed', null, null],
    ['target', FEATURES, 1]
  ],
  q12: [
    ['target', PRICING, 2],
    ['target', PRICING, 2],
    ['target', PRICING, 2]
  ]
}

const TOPIC: Readonly<Record<string, [string, string, string, string]>> = {
  q1: ['Email to SMS basics', 'TOFU', 'Learn', 'Guide'],
  q2: ['Email to SMS basics', 'TOFU', 'Learn', 'Guide'],
  q3: ['Pricing', 'BOFU', 'Buy', 'Product page'],
  q4: ['Email to SMS basics', 'MOFU', 'Learn', 'Guide'],
  q5: ['Email to SMS basics', 'MOFU', 'Do', 'Guide'],
  q6: ['Email to SMS basics', 'MOFU', 'Do', 'Guide'],
  q7: ['Compliance', 'TOFU', 'Learn', 'Guide'],
  q8: ['Compliance', 'MOFU', 'Learn', 'Guide'],
  q9: ['Pricing', 'BOFU', 'Buy', 'Product page'],
  q10: ['Compliance', 'TOFU', 'Learn', 'Guide'],
  q11: ['Email to SMS basics', 'BOFU', 'Do', 'Guide'],
  q12: ['Pricing', 'BOFU', 'Buy', 'Product page']
}

const DOMAINS = ['reddit.com', 'twilio.com', 'simpletexting.com', 'g2.com']

function makeRow(
  q: string,
  check: number,
  engine: 'google_aio' | 'chatgpt',
  plan: Plan
): MetricRow {
  const [checkId, checkedAt] = CHECKS[check]!
  const [result, citedUrl, position] = plan
  const [topic, funnel, intent, pageType] = TOPIC[q]!
  const answered = result !== 'no_answer' && result !== 'failed'
  const n = Number(q.slice(1))
  return {
    id: `${engine}:${checkId}:${q}`,
    questionId: `topic-1|${q}`,
    text: `Question ${n}: how do I send email to SMS ${topic.toLowerCase()} ${n}?`,
    engine,
    marketId: 'us',
    sourceId: 'topic-1',
    sourceKind: 'topic',
    checkId,
    checkedAt,
    result,
    citedUrl,
    position,
    domains: answered ? DOMAINS.filter((_, index) => (n + index + check) % 3 !== 0) : [],
    named: answered && n % 2 === 0,
    segments: { topic, group: null, funnel, intent, pageType }
  }
}

export function sampleRows(): MetricRow[] {
  const rows: MetricRow[] = []
  for (const [q, plans] of Object.entries(GOOGLE)) {
    plans.forEach((plan, check) => rows.push(makeRow(q, check, 'google_aio', plan)))
    // ChatGPT from the second check: it cites q8 (Google never does), else follows Google.
    for (const check of [1, 2]) {
      const plan: Plan = q === 'q8' && check === 2 ? ['other', PRICING, 5] : plans[check]!
      rows.push(
        makeRow(q, check, 'chatgpt', plan[0] === 'failed' ? ['not_cited', null, null] : plan)
      )
    }
  }
  return rows
}

export function samplePages(): MetricPage[] {
  return [
    {
      url: OUTLOOK,
      title: 'Email to SMS from Outlook',
      kind: 'new',
      liveSince: '2026-10-02T00:00:00.000Z',
      indexed: true
    },
    {
      url: FEATURES,
      title: 'Features',
      kind: 'rewrite',
      liveSince: '2026-09-20T00:00:00.000Z',
      indexed: true
    },
    {
      url: SCHOOLS,
      title: 'TextBolt for schools',
      kind: 'new',
      liveSince: '2026-10-23T00:00:00.000Z',
      indexed: false
    }
  ]
}

export function sampleMetrics(
  extra: { engine?: 'all' | 'google_aio' | 'chatgpt'; from?: string | null } = {}
): MetricsResult {
  return computeMetrics({
    rows: sampleRows(),
    pages: samplePages(),
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine: extra.engine ?? 'all',
    window: { from: extra.from === undefined ? CHECKS[0][1] : extra.from, to: null }
  })
}

const DAYS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function sampleContext(kind: ReportKind = 'impact'): ReportContext {
  return {
    brand: 'TextBolt',
    domain: 'textbolt.com',
    kind,
    day: (iso) => {
      const date = new Date(iso)
      return `${DAYS[date.getUTCMonth()]} ${date.getUTCDate()}`
    },
    marketLabel: 'United States · English',
    engineLabel: 'all engines'
  }
}
