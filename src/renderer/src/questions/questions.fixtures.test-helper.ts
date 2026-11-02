import { DEFAULT_TOPIC_BANDS, type TopicSummary } from '@shared/domain'
import type { QuestionRow, QuestionSource, QuestionsList } from '@shared/ipc'

export function questionRow(
  patch: Partial<QuestionRow> & Pick<QuestionRow, 'promptId' | 'sourceId' | 'text'>
): QuestionRow {
  return {
    enabled: true,
    inMarket: true,
    result: 'not_cited',
    status: 'not_cited',
    overview: true,
    cited: false,
    position: null,
    named: false,
    citedInstead: [],
    sentiment: null,
    change: 'none',
    checkedAt: '2026-10-20T10:00:00.000Z',
    runId: 'run-b',
    resultPromptId: patch.promptId,
    resultPageId: patch.sourceId,
    stage: null,
    promptKind: 'question',
    targetPageId: null,
    targetUrl: null,
    previous: null,
    ...patch
  }
}

export const PRICING: QuestionSource = {
  id: 'page-1',
  kind: 'page',
  name: 'Pricing',
  url: 'https://textbolt.com/pricing/',
  path: '/pricing/',
  samples: 1,
  marketIds: ['m-us', 'm-uk']
}

export const TOPIC: QuestionSource = {
  id: 'topic-1',
  kind: 'topic',
  name: 'Business texting',
  url: null,
  path: null,
  samples: 2,
  marketIds: ['m-us']
}

export function questionsList(patch: Partial<QuestionsList> = {}): QuestionsList {
  const rows = patch.rows ?? [
    questionRow({
      promptId: 'p-t1',
      sourceId: 'topic-1',
      text: 'best business texting app for small teams',
      result: 'named',
      named: true,
      citedInstead: ['Twilio', 'reddit.com'],
      sentiment: 'positive'
    }),
    questionRow({
      promptId: 'p-1',
      sourceId: 'page-1',
      text: 'how much does TextBolt cost',
      result: 'cited',
      status: 'page_cited',
      cited: true,
      position: 2,
      change: 'gained'
    }),
    questionRow({
      promptId: 'p-2',
      sourceId: 'page-1',
      text: 'cheapest SMS API for startups',
      result: 'no_overview',
      status: 'no_aio',
      overview: false,
      cited: null,
      named: null,
      change: 'gone'
    }),
    questionRow({
      promptId: 'p-3',
      sourceId: 'page-1',
      text: 'sms pricing per message',
      enabled: false,
      result: 'not_checked',
      status: null,
      overview: null,
      cited: null,
      named: null,
      checkedAt: null,
      runId: null,
      resultPromptId: null
    })
  ]
  return {
    projectId: 'proj-1',
    marketId: 'm-us',
    markets: [
      { id: 'm-us', label: 'US · EN', isDefault: true },
      { id: 'm-uk', label: 'UK · EN', isDefault: false }
    ],
    sources: [TOPIC, PRICING],
    rows,
    facets: {
      kind: { page: 3, topic: 1 },
      source: { 'topic-1': 1, 'page-1': 3 },
      result: { cited: 1, named: 1, not_cited: 0, no_overview: 1, error: 0, not_checked: 1 },
      change: { gained: 1, lost: 0, new_overview: 0, gone: 1, none: 2 }
    },
    lens: { brandNames: ['TextBolt'], ownDomain: 'textbolt.com', includeSubdomains: true },
    hasSentiment: true,
    ...patch
  }
}

export function topicSummary(
  patch: Partial<TopicSummary> & Pick<TopicSummary, 'id' | 'name'>
): TopicSummary {
  return {
    projectId: 'proj-1',
    source: 'seed',
    status: 'tracked',
    questions: 1,
    keywords: 0,
    questionsGoal: null,
    keywordsGoal: null,
    targetPct: null,
    bands: DEFAULT_TOPIC_BANDS,
    intervalDays: 7,
    checkedAt: null,
    pendingBatches: 0,
    ...patch
  }
}
