import { vi } from 'vitest'
import type { TopicSummary } from '@shared/domain'
import type {
  QuestionRow,
  QuestionSource,
  QuestionsList,
  TopicFolder,
  TopicFolderList,
  TopicIdea
} from '@shared/ipc'
import { questionRow, topicSummary } from '../../questions/questions.fixtures.test-helper'
import type { ClustersSource } from '../clusters'

const PROJECT_ID = 'proj-1'
const NOW = '2026-10-29T10:27:00.000Z'

export const ALERTS: QuestionSource = {
  id: 'topic-a',
  kind: 'topic',
  name: 'Replacing a carrier email-to-text gateway',
  url: null,
  path: null,
  samples: 1,
  marketIds: ['m-us']
}

export const TENDLC: QuestionSource = { ...ALERTS, id: 'topic-b', name: '10DLC for small senders' }

export const PRICING: QuestionSource = {
  id: 'page-1',
  kind: 'page',
  name: 'Pricing',
  url: 'https://textbolt.com/pricing/',
  path: '/pricing/',
  samples: 1,
  marketIds: ['m-us']
}

const PRICING_URL = 'https://textbolt.com/pricing/'
const GATEWAY_URL = 'https://textbolt.com/email-to-text/'

function prev(cited: boolean, overview = true): QuestionRow['previous'] {
  return {
    overview,
    cited: overview ? cited : null,
    checkedAt: '2026-10-06T10:00:00.000Z',
    runId: 'run-a',
    promptId: 'old',
    pageId: 'topic-a'
  }
}

/**
 * Topic A: 4 questions (3 with an overview, 2 cited = 67%, in band) and a keyword;
 * stages Problem ×2, Options, Compare. Topic B: 2 questions, 1 overview, 0 cited.
 * The pricing page has 2 questions not in a topic.
 */
export function topicsRows(): QuestionRow[] {
  return [
    questionRow({
      promptId: 'a1',
      sourceId: 'topic-a',
      text: 'why did my carrier email to text stop working',
      result: 'cited',
      cited: true,
      stage: 'problem',
      targetUrl: GATEWAY_URL,
      targetPageId: 'page-2',
      previous: prev(false)
    }),
    questionRow({
      promptId: 'a2',
      sourceId: 'topic-a',
      text: 'verizon vtext shut down what now',
      result: 'cited',
      cited: true,
      stage: 'problem',
      targetUrl: GATEWAY_URL,
      targetPageId: 'page-2',
      previous: prev(true)
    }),
    questionRow({
      promptId: 'a3',
      sourceId: 'topic-a',
      text: 'best email to sms service for alerts',
      stage: 'options',
      targetUrl: PRICING_URL,
      targetPageId: 'page-1',
      previous: prev(false)
    }),
    questionRow({
      promptId: 'a4',
      sourceId: 'topic-a',
      text: 'textbolt vs twilio for alerts',
      result: 'no_overview',
      overview: false,
      cited: null,
      stage: 'compare',
      previous: prev(false, false)
    }),
    questionRow({
      promptId: 'a5',
      sourceId: 'topic-a',
      text: 'email to text gateway',
      promptKind: 'keyword',
      stage: null
    }),
    questionRow({
      promptId: 'b1',
      sourceId: 'topic-b',
      text: 'why was my 10dlc campaign rejected',
      stage: 'problem'
    }),
    questionRow({
      promptId: 'b2',
      sourceId: 'topic-b',
      text: '10dlc registration cost',
      result: 'not_checked',
      overview: null,
      cited: null,
      checkedAt: null,
      runId: null,
      stage: 'problem'
    }),
    questionRow({
      promptId: 'p1',
      sourceId: 'page-1',
      text: 'how much does business texting cost',
      result: 'cited',
      cited: true,
      targetUrl: PRICING_URL,
      targetPageId: 'page-1',
      stage: 'options'
    }),
    questionRow({
      promptId: 'p2',
      sourceId: 'page-1',
      text: 'cheapest sms for small business',
      targetUrl: PRICING_URL,
      targetPageId: 'page-1',
      stage: null
    })
  ]
}

export function topicsList(rows: QuestionRow[] = topicsRows()): QuestionsList {
  return {
    projectId: 'proj-1',
    marketId: 'm-us',
    markets: [{ id: 'm-us', label: 'US · EN', isDefault: true }],
    sources: [ALERTS, TENDLC, PRICING],
    rows,
    facets: {
      kind: { page: 2, topic: rows.length - 2 },
      source: {},
      result: { cited: 0, named: 0, not_cited: 0, no_overview: 0, error: 0, not_checked: 0 },
      change: { gained: 0, lost: 0, new_overview: 0, gone: 0, none: 0 }
    },
    lens: { brandNames: ['TextBolt'], ownDomain: 'textbolt.com', includeSubdomains: false },
    hasSentiment: false
  } as unknown as QuestionsList
}

export function topicsSummaries(): TopicSummary[] {
  return [
    topicSummary({
      id: 'topic-a',
      name: ALERTS.name,
      intervalDays: 14,
      checkedAt: '2026-10-23T09:00:00.000Z'
    }),
    topicSummary({ id: 'topic-b', name: TENDLC.name, source: 'questions', intervalDays: 30 }),
    topicSummary({ id: 'topic-gone', name: 'Old topic', status: 'removed' })
  ]
}

export const IDEAS: TopicIdea[] = [
  {
    id: 'idea-1',
    name: 'Text alerts from monitoring tools',
    situation: 'An on-call lead wants SMS when Grafana fires.',
    example: 'send an SMS when a Grafana alert fires',
    questions: [
      { text: 'how do I get grafana alerts by text', stage: 'problem' },
      { text: 'best sms alerting tool for devops', stage: 'options' }
    ],
    fitsUrl: null
  },
  {
    id: 'idea-2',
    name: 'Appointment reminders for small clinics',
    situation: 'A two-doctor practice wants reminders from Outlook.',
    example: 'cheapest way to text appointment reminders',
    questions: [{ text: 'how do clinics text appointment reminders', stage: 'problem' }],
    fitsUrl: 'https://textbolt.com/pricing/'
  },
  {
    id: 'idea-3',
    name: 'A cheaper alternative for alerts',
    situation: 'A team got a developer quote.',
    example: 'twilio alternative for alerts',
    questions: [{ text: 'twilio alternative without code', stage: 'compare' }],
    fitsUrl: null
  }
]

/** A fake of the channels the Topics screen uses, recording requests by channel. */
export function fakeTopicsSource(
  list: QuestionsList = topicsList(),
  topics: TopicSummary[] = topicsSummaries(),
  folders: readonly TopicFolder[] = []
): ClustersSource & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {}
  const record = (name: string, value: unknown): void => {
    ;(calls[name] ??= []).push(value)
  }
  const info = {
    label: { text: 'CiteFox AI · about 20 s' },
    durationMs: 1,
    model: null,
    searchesUsed: 0
  } as never
  const fail = (name: string): ((request: unknown) => Promise<never>) =>
    vi.fn(async (request: unknown) => {
      record(name, request)
      throw new Error(`${name} is not faked`)
    })
  return {
    calls,
    'questions:list': vi.fn(async (request) => {
      record('questions:list', request)
      return list
    }),
    'questions:update': fail('questions:update'),
    'topics:list': vi.fn(async (request) => {
      record('topics:list', request)
      return { topics }
    }),
    'topics:update': vi.fn(async (request) => {
      record('topics:update', request)
      const topic = topics.find((item) => item.id === request.topicId) ?? topics[0]
      // Keep the change, so the next topics:list shows it (paused, removed, renamed).
      if (topic && request.status) topic.status = request.status
      if (topic && request.name) topic.name = request.name
      return { ...(topic as TopicSummary) }
    }),
    'topics:setTarget': fail('topics:setTarget'),
    'topics:pageCandidates': fail('topics:pageCandidates'),
    'topics:describeStep': fail('topics:describeStep'),
    'topics:moveQuestions': vi.fn(async (request) => {
      record('topics:moveQuestions', request)
      return {
        moved: request.items.length,
        topicId: request.to.kind === 'topic' ? request.to.topicId : null,
        promptIds: [],
        skipped: [],
        message: 'Moved.'
      }
    }),
    'topics:setQuestionStage': fail('topics:setQuestionStage'),
    'topics:merge': vi.fn(async (request) => {
      record('topics:merge', request)
      return {
        moved: 4,
        topicId: request.intoTopicId,
        promptIds: [{ from: 'q-1', to: 'q-41' }],
        skipped: [],
        message: 'Merged.'
      }
    }),
    'topics:split': vi.fn(async (request) => {
      record('topics:split', request)
      return { topics: [], kept: 2, message: 'Split Replacing into 3 topics.' }
    }),
    'topics:createTopics': vi.fn(async (request) => {
      record('topics:createTopics', request)
      return {
        topicIds: request.topics.map((_: unknown, index: number) => `new-${index}`),
        questions: 3,
        message: 'Created 2 topics with 3 questions. Nothing is checked until you press Check now.'
      }
    }),
    'topics:createFromDraft': fail('topics:createFromDraft'),
    'topics:suggestTopics': vi.fn(async (request) => {
      record('topics:suggestTopics', request)
      return { ideas: IDEAS, info, message: null }
    }),
    'topics:sortQuestions': fail('topics:sortQuestions'),
    'topics:suggestName': fail('topics:suggestName'),
    'topics:createEmpty': vi.fn(async (request) => {
      record('topics:createEmpty', request)
      return {
        topicId: 'topic-new',
        name: request.name,
        questions: 0,
        message: `Created ${request.name}. Add its questions next; nothing is checked until it has some.`
      }
    }),
    'topics:duplicate': vi.fn(async (request) => {
      record('topics:duplicate', request)
      const topic = topics.find((item) => item.id === request.topicId)
      const name = request.name ?? `${topic?.name ?? 'Topic'} (copy)`
      return {
        topicId: `${request.topicId}-copy`,
        name,
        questions: 4,
        message: `Made ${name} with 4 questions. Nothing is checked until you press Check now.`
      }
    }),
    ...fakeFolderChannels(record, folders)
  }
}

/** In-memory topic folders: each channel changes the list and answers with all of it. */
export function fakeFolderChannels(
  record: (name: string, value: unknown) => void,
  start: readonly TopicFolder[] = []
): Pick<
  ClustersSource,
  | 'topics:folders'
  | 'topics:createFolder'
  | 'topics:renameFolder'
  | 'topics:deleteFolder'
  | 'topics:moveToFolder'
> {
  let folders = start.map((folder) => ({ ...folder, topicIds: [...folder.topicIds] }))
  let made = 0
  const answer = (): TopicFolderList => ({ projectId: PROJECT_ID, folders })
  const without = (ids: readonly string[]): void => {
    folders = folders.map((folder) => ({
      ...folder,
      topicIds: folder.topicIds.filter((id) => !ids.includes(id))
    }))
  }
  return {
    'topics:folders': vi.fn(async (request) => {
      record('topics:folders', request)
      return answer()
    }),
    'topics:createFolder': vi.fn(async (request) => {
      record('topics:createFolder', request)
      const ids = request.topicIds ?? []
      without(ids)
      made += 1
      folders = [
        ...folders,
        { id: `folder-new-${made}`, name: request.name.trim(), createdAt: NOW, topicIds: [...ids] }
      ]
      return answer()
    }),
    'topics:renameFolder': vi.fn(async (request) => {
      record('topics:renameFolder', request)
      folders = folders.map((folder) =>
        folder.id === request.folderId ? { ...folder, name: request.name.trim() } : folder
      )
      return answer()
    }),
    'topics:deleteFolder': vi.fn(async (request) => {
      record('topics:deleteFolder', request)
      folders = folders.filter((folder) => folder.id !== request.folderId)
      return answer()
    }),
    'topics:moveToFolder': vi.fn(async (request) => {
      record('topics:moveToFolder', request)
      without(request.topicIds)
      folders = folders.map((folder) =>
        folder.id === request.folderId
          ? { ...folder, topicIds: [...folder.topicIds, ...request.topicIds] }
          : folder
      )
      return answer()
    })
  }
}
