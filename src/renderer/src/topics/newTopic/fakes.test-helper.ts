import type { QuestionRow, QuestionSource, QuestionsList, TopicCallInfo } from '@shared/ipc'
import type { HelpFillResult } from '@shared/ipc'
import type { HelpFillSource } from '../../ui'
import type { ClustersSource } from '../clusters/source'

export const PROJECT_ID = 'p1'
export const SITE = 'https://textbolt.com'

const INFO = {
  label: {
    connection: 'claude-code',
    connectionText: 'CiteFox AI · on your plan',
    expectedSeconds: 12,
    text: 'CiteFox AI · on your plan · about 12 s'
  },
  draftId: 'none',
  marketId: null
} as unknown as TopicCallInfo

function source(
  id: string,
  kind: 'page' | 'topic',
  name: string,
  path: string | null
): QuestionSource {
  return {
    id,
    kind,
    name,
    url: path === null ? null : `${SITE}${path}`,
    path,
    samples: 1,
    marketIds: ['us']
  }
}

function row(promptId: string, sourceId: string, text: string): QuestionRow {
  return {
    promptId,
    sourceId,
    text,
    enabled: true,
    inMarket: true,
    stage: null,
    promptKind: 'question',
    targetPageId: null,
    targetUrl: null
  } as unknown as QuestionRow
}

/** Three questions on the alerts page and one already in a topic. */
function startingRows(): QuestionRow[] {
  return [
    row('q1', 'page-alerts', 'How do I get a text when a server goes down?'),
    row('q2', 'page-alerts', 'Can our help desk send SMS alerts from email?'),
    row('q3', 'page-alerts', 'What does an SMS gateway cost per month?'),
    row('t1', 'topic-old', 'Which bulk SMS tools work for schools?')
  ]
}

function listOf(rows: readonly QuestionRow[], topics: readonly QuestionSource[]): QuestionsList {
  return {
    projectId: PROJECT_ID,
    marketId: 'us',
    markets: [{ id: 'us', label: 'US · EN', isDefault: true }],
    sources: [...topics, source('page-alerts', 'page', 'Text alerts', '/use-cases/it-alerts/')],
    rows,
    facets: { kind: { page: 3, topic: 1 }, source: {}, result: {}, change: {} },
    lens: { brands: [], domain: 'textbolt.com' },
    hasSentiment: false
  } as unknown as QuestionsList
}

/**
 * The clusters channels over an in-memory project: `questions:list` follows moves, so
 * after "Create topic" from tracked questions the new topic's questions come back.
 */
export function fakeClusters(): { source: ClustersSource; calls: Record<string, unknown[]> } {
  let rows = startingRows()
  let topics = [source('topic-old', 'topic', 'School alerts', null)]
  const calls: Record<string, unknown[]> = {}
  const record = (channel: string, request: unknown): void => {
    ;(calls[channel] ??= []).push(request)
  }
  const unused = (channel: string) => async (request: unknown) => {
    record(channel, request)
    throw new Error(`${channel} is not used by New topic`)
  }
  const fake: ClustersSource = {
    'questions:list': async (request) => {
      record('questions:list', request)
      return listOf(rows, topics)
    },
    'questions:update': unused('questions:update'),
    'topics:list': unused('topics:list'),
    'topics:update': unused('topics:update'),
    'topics:setTarget': async (request) => {
      record('topics:setTarget', request)
      return { draft: null, rows: [] }
    },
    'topics:pageCandidates': async (request) => {
      record('topics:pageCandidates', request)
      return {
        candidates: [
          {
            pageId: 'page-pricing',
            url: `${SITE}/pricing/`,
            title: 'Pricing',
            source: 'tracked' as const,
            outline: []
          },
          {
            pageId: 'page-alerts',
            url: `${SITE}/use-cases/it-alerts/`,
            title: 'Text alerts',
            source: 'tracked' as const,
            outline: []
          }
        ],
        sitemapReadAt: null
      }
    },
    'topics:describeStep': unused('topics:describeStep'),
    'topics:moveQuestions': async (request) => {
      record('topics:moveQuestions', request)
      const ids = new Set(request.items.map((item) => item.promptId))
      const name = request.to.kind === 'new' ? request.to.name : 'Topic'
      topics = [...topics, source('topic-new', 'topic', name, null)]
      rows = rows.map((item) =>
        ids.has(item.promptId)
          ? { ...item, promptId: `${item.promptId}-moved`, sourceId: 'topic-new' }
          : item
      )
      return {
        moved: ids.size,
        topicId: 'topic-new',
        promptIds: [...ids].map((from) => ({ from, to: `${from}-moved` })),
        skipped: [],
        message: `Moved ${ids.size} questions to ${name}.`
      }
    },
    'topics:setQuestionStage': unused('topics:setQuestionStage'),
    'topics:merge': unused('topics:merge'),
    'topics:split': unused('topics:split'),
    'topics:createTopics': unused('topics:createTopics'),
    'topics:createFromDraft': async (request) => {
      record('topics:createFromDraft', request)
      return {
        topicId: 'topic-new',
        questions: 10,
        moved: request.moveIn?.length ?? 0,
        message: 'Created.'
      }
    },
    'topics:suggestTopics': unused('topics:suggestTopics'),
    'topics:sortQuestions': async (request) => {
      record('topics:sortQuestions', request)
      return {
        proposals: request.items.map((item) => ({
          sourceId: item.sourceId,
          promptId: item.promptId,
          text: '',
          topicId: item.promptId === 'q1' ? 'new' : null,
          newTopic: null,
          reason: item.promptId === 'q1' ? 'Same situation.' : 'A different buyer.'
        })),
        info: INFO
      }
    },
    'topics:suggestName': async (request) => {
      record('topics:suggestName', request)
      return {
        name: 'Server alert texts',
        situation: 'An IT team needs a text when a server goes down.',
        info: INFO
      }
    },
    'topics:createEmpty': unused('topics:createEmpty'),
    'topics:duplicate': unused('topics:duplicate'),
    'topics:folders': unused('topics:folders'),
    'topics:createFolder': unused('topics:createFolder'),
    'topics:renameFolder': unused('topics:renameFolder'),
    'topics:deleteFolder': unused('topics:deleteFolder'),
    'topics:moveToFolder': unused('topics:moveToFolder')
  }
  return { source: fake, calls }
}

const TOPIC = 'Carrier gateway shutdown'

/** What main reads from a pasted answer for a new topic: three ready, one tracked. */
export const TOPIC_ANSWER: HelpFillResult = {
  kind: 'topic',
  rows: [
    {
      id: 'row-1',
      section: null,
      values: {
        question: 'Our carrier stopped email to text, what now?',
        stage: 'problem',
        page: '/use-cases/it-alerts/',
        topic: TOPIC
      }
    },
    {
      id: 'row-2',
      section: null,
      values: {
        question: 'What replaces a carrier email gateway?',
        stage: 'options',
        page: `${SITE}/use-cases/it-alerts`,
        topic: TOPIC
      }
    },
    {
      id: 'row-4',
      section: null,
      values: {
        question: 'How much does an SMS gateway cost?',
        stage: 'compare',
        page: '/guides/sms-gateway-cost/',
        topic: TOPIC
      }
    }
  ],
  setAside: [],
  counts: { read: 4, tracked: 1, repeats: 0, setAside: 0, ready: 3 },
  noun: ['question', 'questions'],
  brand: 'TextBolt',
  warnings: []
}

/**
 * The ✦ Help me fill channels for New topic: the estimate (Claude set up or not), the
 * topic prompt, and a read that answers {@link TOPIC_ANSWER}. Describe is never called.
 */
export function fakeHelpFill(claude: boolean): {
  source: HelpFillSource
  calls: { estimate: number; prompt: unknown[]; read: unknown[] }
} {
  const calls = { estimate: 0, prompt: [] as unknown[], read: [] as unknown[] }
  const source: HelpFillSource = {
    'helpfill:estimate': async (request) => {
      calls.estimate += 1
      return {
        kind: request.kind,
        available: claude,
        calls: 1,
        costText: claude ? '1 AI call · on your AI plan' : '1 AI call',
        reason: claude ? null : 'Needs CiteFox AI connected.'
      }
    },
    'helpfill:prompt': async (request) => {
      calls.prompt.push(request)
      return {
        kind: 'topic',
        prompt: [
          'You help a company plan one topic.',
          'Business: textbolt.com.',
          "Already tracked, don't repeat: 3 questions, listed below.",
          '',
          'Reply with CSV only, this header:',
          'question,stage,page,topic'
        ].join('\n'),
        columns: ['question', 'stage', 'page', 'topic'],
        tracked: 3
      }
    },
    'helpfill:read': async (request) => {
      calls.read.push(request)
      return TOPIC_ANSWER
    },
    'helpfill:describe': async () => {
      throw new Error('New topic never calls helpfill:describe')
    }
  }
  return { source, calls }
}
