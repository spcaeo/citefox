import { createElement, Fragment } from 'react'
import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import type {
  CheckJob,
  MoveQuestionsResult,
  QuestionsList,
  QuestionsUpdateResult,
  SetQuestionStageResult,
  SortQuestionsRequest,
  SortQuestionsResult,
  TopicPageCandidates
} from '@shared/ipc'
import { UndoToastHost } from '../ui/UndoToast'
import { QuestionsScreen } from './QuestionsScreen'
import type { QuestionsSource } from './source'
import { questionsList, topicSummary } from './questions.fixtures.test-helper'

const TOPIC_NAMES: Readonly<Record<string, string>> = {
  'topic-1': 'Business texting',
  'topic-2': 'Text alerts'
}

/** A fake of every channel the screen uses, recording each request by short name. */
export function fakeSource(list: QuestionsList = questionsList()): QuestionsSource & {
  calls: Record<string, unknown[]>
} {
  const calls: Record<string, unknown[]> = {}
  const record = (name: string, value: unknown): void => {
    ;(calls[name] ??= []).push(value)
  }
  const plural = (count: number): string => `${count} question${count === 1 ? '' : 's'}`
  return {
    calls,
    'questions:list': vi.fn(async (request) => {
      record('list', request)
      return list
    }),
    'questions:update': vi.fn(async (request): Promise<QuestionsUpdateResult> => {
      record('update', request)
      const verb =
        request.action === 'remove'
          ? 'Removed'
          : request.action === 'disable'
            ? 'Paused'
            : 'Resumed'
      return {
        changed: request.items.length,
        skipped: [],
        message: `${verb} ${plural(request.items.length)}.`,
        restore: [{ sourceId: 'page-1', promptSetId: 'pset-old', replacedBy: 'pset-new' }]
      }
    }),
    'checks:start': vi.fn(async (request): Promise<CheckJob> => {
      record('start', request)
      return {
        id: 'job-1',
        projectId: request.projectId,
        pageIds: request.pageIds,
        marketIds: request.marketIds,
        promptIds: request.promptIds,
        status: 'finished',
        startedAt: '2026-10-23T10:00:00.000Z',
        finishedAt: '2026-10-23T10:01:00.000Z',
        done: 2,
        total: 2,
        searchesUsed: 3,
        searchesMax: 6
      } as CheckJob
    }),
    'status:getCapsule': vi.fn(async () => ({
      searchesLeft: 500,
      issueCount: 0,
      serpapi: 'connected',
      claudeCode: 'connected',
      jina: 'connected',
      youtube: 'connected'
    })) as unknown as QuestionsSource['status:getCapsule'],
    'topics:list': vi.fn(async (request) => {
      record('topics', request)
      return {
        topics: [
          topicSummary({ id: 'topic-1', name: 'Business texting' }),
          topicSummary({ id: 'topic-2', name: 'Text alerts', questions: 0 })
        ]
      }
    }),
    'topics:moveQuestions': vi.fn(async (request): Promise<MoveQuestionsResult> => {
      record('move', request)
      const where =
        request.to.kind === 'topic'
          ? (TOPIC_NAMES[request.to.topicId] ?? request.to.topicId)
          : request.to.kind === 'new'
            ? request.to.name
            : 'its page'
      return {
        moved: request.items.length,
        topicId: request.to.kind === 'topic' ? request.to.topicId : null,
        promptIds: [],
        skipped: [],
        message: `Moved ${plural(request.items.length)} to ${where}.`
      }
    }),
    'topics:setQuestionStage': vi.fn(async (request): Promise<SetQuestionStageResult> => {
      record('stage', request)
      return {
        changed: request.items.length,
        skipped: [],
        message: `Set the stage of ${plural(request.items.length)}.`
      }
    }),
    'topics:setTarget': vi.fn(async (request) => {
      record('target', request)
      return { draft: null, rows: [] }
    }),
    'topics:pageCandidates': vi.fn(async (request): Promise<TopicPageCandidates> => {
      record('candidates', request)
      return {
        candidates: [
          {
            pageId: 'page-1',
            url: 'https://textbolt.com/pricing/',
            title: 'Pricing',
            source: 'tracked',
            outline: []
          },
          {
            pageId: null,
            url: 'https://textbolt.com/sms-api/',
            title: 'SMS API',
            source: 'sitemap',
            outline: []
          }
        ],
        sitemapReadAt: null
      }
    }),
    'topics:sortQuestions': vi.fn(
      async (request: SortQuestionsRequest): Promise<SortQuestionsResult> => {
        record('sort', request)
        return {
          proposals: request.items.map((item, index) => ({
            ...item,
            text: `question ${item.promptId}`,
            topicId: index === 0 ? 'topic-1' : null,
            newTopic: index === 0 ? null : 'SMS pricing',
            reason: 'Asks about the same job.'
          })),
          info: {
            label: {
              connection: 'claude-code',
              connectionText: 'CiteFox AI · on your plan',
              expectedSeconds: 10,
              text: 'CiteFox AI · on your plan · about 10 s'
            },
            durationMs: 900,
            model: null,
            searchesUsed: 0
          }
        }
      }
    ),
    'topics:describeStep': vi.fn(async () => {
      throw new Error('Not used here.')
    })
  }
}

export type FakeSource = ReturnType<typeof fakeSource>

/** Sets the hash the way Back and Forward do, and tells listeners. */
export function goTo(hash: string): void {
  act(() => {
    window.history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

export function query(): URLSearchParams {
  const hash = window.location.hash
  return new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '')
}

export async function shown(
  source: FakeSource = fakeSource()
): Promise<{ view: RenderResult; source: FakeSource }> {
  // The toast host renders the Undo toast every question action ends with.
  const view = render(
    createElement(
      Fragment,
      null,
      createElement(QuestionsScreen, { projectId: 'proj-1', source }),
      createElement(UndoToastHost)
    )
  )
  await view.findByRole('grid', { name: 'Questions' })
  return { view, source }
}

/** Picks a choice in the list's Filter ▾ menu, such as "Result: Cited", then closes it. */
export function pickFilter(view: RenderResult, name: string): void {
  fireEvent.click(view.getByRole('button', { name: /^Filter/ }))
  fireEvent.click(view.getByRole('menuitemradio', { name }))
  fireEvent.click(view.getByRole('button', { name: /^Filter/ }))
}

/** The picked choice of a Filter ▾ group ("Result"), read from the open menu. */
export function filterValue(view: RenderResult, group: string): string {
  fireEvent.click(view.getByRole('button', { name: /^Filter/ }))
  const picked = view
    .getAllByRole('menuitemradio')
    .find(
      (item) =>
        item.getAttribute('aria-checked') === 'true' &&
        (item.getAttribute('aria-label') ?? '').startsWith(`${group}: `)
    )
  fireEvent.click(view.getByRole('button', { name: /^Filter/ }))
  return (picked?.getAttribute('aria-label') ?? '').slice(group.length + 2)
}

/** Picks a grouping in Group ▾ ("None", "Stage", …). */
export function pickGroup(view: RenderResult, label: string): void {
  fireEvent.click(view.getByRole('combobox', { name: 'Group by' }))
  fireEvent.click(within(view.getByRole('listbox')).getByRole('option', { name: label }))
}
