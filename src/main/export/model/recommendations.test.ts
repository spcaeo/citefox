import { describe, expect, test } from 'vitest'
import type { CitationClass } from '@shared/domain'
import { DrillRegistry } from './drills'
import { buildRecommendations, EVIDENCE_ROWS, type RecommendationInput } from './recommendations'
import type { ContentGapsSection, ReportPage, ReportReference, ReportRow } from './types'

const PAGES: ReportPage[] = [
  { id: 'p1', url: 'https://acme.com/alerts', path: '/alerts', title: 'Alerts', role: 'tracked' },
  {
    id: 'p2',
    url: 'https://acme.com/pricing',
    path: '/pricing',
    title: 'Pricing',
    role: 'tracked'
  },
  { id: 't1', url: 'topic:t1', path: 'topic:t1', title: 'Text alerts', role: 'tracked' }
]

const NO_GAPS: ContentGapsSection = {
  empty: null,
  pageRead: null,
  matrix: [],
  summary: '',
  oneByOne: [],
  pageWide: []
}

let next = 0

function row(overrides: Partial<ReportRow>): ReportRow {
  next += 1
  return {
    id: `r${next}`,
    promptId: `q${next}`,
    pageId: 'p1',
    marketId: 'us',
    runId: 'run',
    number: next,
    label: `P${next}`,
    text: `Question ${next}?`,
    stage: 'problem',
    funnel: 'TOFU',
    source: 'title_meta_h1',
    status: 'not_cited',
    aio: true,
    cited: false,
    pageCited: false,
    named: false,
    wrongPage: false,
    notVisible: true,
    citedUrl: null,
    position: null,
    topDomains: [],
    checkedAt: null,
    aioExcerpt: null,
    ...overrides
  }
}

function ref(
  rowId: string,
  url: string,
  classification: CitationClass,
  position = 1
): ReportReference {
  const domain = new URL(url).hostname
  return {
    rowId,
    position,
    url,
    normalizedUrl: url,
    domain,
    title: `${domain} page`,
    classification,
    untracked: false,
    sourceType: 'web'
  }
}

function input(
  rows: ReportRow[],
  references: ReportReference[],
  extra: Partial<RecommendationInput> = {}
): RecommendationInput {
  return {
    rows,
    references,
    pages: PAGES,
    contentGaps: NO_GAPS,
    ownDomain: 'acme.com',
    topicPageIds: new Set(['t1']),
    drills: new DrillRegistry(),
    ...extra
  }
}

describe('What to do next', () => {
  test('no evidence, no recommendation', () => {
    const cited = row({ cited: true, pageCited: true, notVisible: false, status: 'page_cited' })
    const noAio = row({ aio: false, notVisible: false, status: 'no_aio' })
    expect(buildRecommendations(input([cited, noAio], []))).toEqual([])
  })

  test('a competitor cited where you are not: Do this, Why with the count, and the evidence', () => {
    const rows = [row({}), row({}), row({ named: true, notVisible: false })]
    const refs = rows.flatMap((item) => [
      ref(item.id, 'https://www.reddit.com/r/x', 'other', 1),
      ref(item.id, 'https://twilio.com/docs/sms', 'competitor', 2)
    ])
    const drills = new DrillRegistry()
    const [first, ...rest] = buildRecommendations(input(rows, refs, { drills }))
    expect(rest).toEqual([])
    expect(first).toMatchObject({
      kind: 'competitor_gap',
      doThis:
        'Answer these questions directly on /alerts, so Google can cite you where it now cites twilio.com.',
      why: 'twilio.com is cited in 3 AI Overviews that do not cite you.',
      questions: { n: 3, drill: 'next:competitor=twilio.com' }
    })
    expect(drills.toRecord()['next:competitor=twilio.com']).toEqual(rows.map((item) => item.id))
    // The competitor's own page is the page Google cited instead, not the first link.
    expect(first?.evidence[0]).toEqual({
      rowId: rows[0]?.id,
      question: rows[0]?.text,
      pagePath: '/alerts',
      marketId: 'us',
      competitor: 'twilio.com',
      citedUrl: 'https://twilio.com/docs/sms',
      citedTitle: 'twilio.com page'
    })
  })

  test('wrong page cited shows your other page; at most three, largest first, ties by kind', () => {
    const wrong = [1, 2].map(() =>
      row({
        cited: true,
        wrongPage: true,
        notVisible: false,
        status: 'other_own_page',
        citedUrl: 'https://acme.com/blog/old'
      })
    )
    const open = [1, 2, 3, 4].map(() => row({ pageId: 'p2' }))
    const rival = [1, 2].map(() => row({}))
    const refs = [
      ...wrong.map((item) => ref(item.id, 'https://acme.com/blog/old', 'own')),
      ...open.map((item) => ref(item.id, 'https://www.g2.com/sms', 'other')),
      ...rival.map((item) => ref(item.id, 'https://twilio.com/', 'competitor'))
    ]
    const recs = buildRecommendations(input([...wrong, ...open, ...rival], refs))
    expect(recs.map((item) => item.kind)).toEqual(['not_visible', 'competitor_gap', 'wrong_page'])
    expect(recs[0]?.why).toBe(
      'Google shows an AI Overview for 4 questions without citing or naming you or a competitor; it cites g2.com most.'
    )
    expect(recs[0]?.doThis).toContain('on /pricing;')
    expect(recs[2]?.doThis).toBe(
      'Make /alerts the clearest answer to these questions, and link to it from the page Google cites now.'
    )
    expect(recs[2]?.evidence[0]).toMatchObject({
      competitor: null,
      citedUrl: 'https://acme.com/blog/old'
    })
  })

  test('content gaps: weak or missing coverage, with the FAQ drafts named', () => {
    const rows = [
      row({ cited: true, notVisible: false, status: 'page_cited' }),
      row({ aio: false, notVisible: false })
    ]
    const gaps: ContentGapsSection = {
      ...NO_GAPS,
      matrix: rows.map((item, index) => ({
        number: index + 1,
        rowId: item.id,
        prompt: item.text,
        coverage: index === 0 ? 'weak' : 'none',
        whereCovered: [],
        mainGap: 'No answer',
        actions: [],
        actionLabel: 'New FAQ'
      })),
      oneByOne: [
        {
          number: 1,
          prompt: 'Q',
          now: '',
          update: '',
          newFaq: true,
          faq: { question: 'Q', answer: 'A', words: 50 }
        }
      ]
    }
    const [first] = buildRecommendations(input(rows, [], { contentGaps: gaps }))
    expect(first).toMatchObject({
      kind: 'content_gap',
      doThis: 'Add the missing answers to /alerts, starting from the FAQ drafts in Content gaps.',
      why: 'The page covers 2 of these buyer questions weakly or not at all.'
    })
  })

  test('evidence is capped; several pages and topics are named by path or title', () => {
    const rows = Array.from({ length: EVIDENCE_ROWS + 2 }, (_, index) =>
      row({ pageId: index === 0 ? 't1' : 'p1' })
    )
    const [first] = buildRecommendations(input(rows, []))
    expect(first?.questions.n).toBe(EVIDENCE_ROWS + 2)
    expect(first?.evidence).toHaveLength(EVIDENCE_ROWS)
    expect(first?.evidence[0]?.pagePath).toBe('Text alerts')
    expect(first?.doThis).toContain('on each question’s tracked page;')
    // One question citing a site is not a pattern: no "most" site named.
    expect(first?.why).not.toContain('most')
  })
})
