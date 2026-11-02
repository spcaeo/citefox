import { vi, type Mock } from 'vitest'
import type { QuestionDetail, QuestionTarget, QuestionTargets } from '@shared/ipc'
import { questionsList } from '../questions/questions.fixtures.test-helper'
import type { QuestionEditSource } from './source'

export function questionDetail(patch: Partial<QuestionDetail> = {}): QuestionDetail {
  return {
    projectId: 'proj-1',
    sourceId: 'page-1',
    sourceKind: 'page',
    sourceName: 'Pricing',
    sourceUrl: 'https://textbolt.com/pricing',
    promptId: 'p-1',
    active: true,
    currentPromptId: null,
    label: 'Pricing question',
    source: 'title_meta_h1',
    intentStage: 'solution',
    topicStage: null,
    topicKind: null,
    enabled: true,
    wordings: [
      {
        marketId: 'm-us',
        marketLabel: 'US · EN',
        isDefault: true,
        text: 'how much does a business texting app cost per month for a small team'
      },
      {
        marketId: 'm-uk',
        marketLabel: 'UK · EN',
        isDefault: false,
        text: 'how much does a business texting app cost per month for a small team'
      }
    ],
    rules: { kind: 'buyer_prompt', minWords: 8, maxWords: 32, brands: ['TextBolt'] },
    draftOpen: false,
    ...patch
  }
}

function target(patch: Partial<QuestionTarget>): QuestionTarget {
  return {
    id: 'page-1',
    kind: 'page',
    name: 'Pricing',
    url: 'https://textbolt.com/pricing',
    status: 'tracked',
    questions: 3,
    keywords: 0,
    samples: 1,
    marketIds: ['m-us'],
    nextCheckAt: null,
    ...patch
  }
}

export function questionTargets(): QuestionTargets {
  return {
    projectId: 'proj-1',
    markets: [],
    searchesLeft: 500,
    targets: [
      target({}),
      target({ id: 'page-2', name: 'Features', url: 'https://textbolt.com/features' }),
      target({ id: 'topic-1', kind: 'topic', name: 'Business texting', url: null }),
      target({ id: 'topic-2', kind: 'topic', name: 'Text alerts', url: null })
    ]
  }
}

/** Every channel as a spy, so a test can read its calls or change its answer. */
export type FakeEditSource = { [K in keyof QuestionEditSource]: QuestionEditSource[K] & Mock }

/** A fake of every channel the shared question actions use, each a spy. */
export function fakeEditSource(detail: QuestionDetail = questionDetail()): FakeEditSource {
  return {
    'questions:get': vi.fn(async () => detail),
    'questions:edit': vi.fn(async (request) => ({
      sourceId: request.sourceId,
      promptId: 'p-1b',
      previousPromptId: request.promptId,
      changed: true,
      restore: { sourceId: request.sourceId, promptSetId: 'set-1', replacedBy: 'set-2' },
      message: 'Saved.'
    })),
    'questions:update': vi.fn(async (request) => ({
      changed: request.items.length,
      skipped: [],
      message: `Removed ${request.items.length} question.`,
      restore: [{ sourceId: 'page-1', promptSetId: 'set-1', replacedBy: 'set-2' }]
    })),
    'questions:restore': vi.fn(async () => ({ restored: 1, skipped: [], message: 'Undone.' })),
    'questions:list': vi.fn(async () => questionsList()),
    'topics:moveQuestions': vi.fn(async (request) => ({
      moved: request.items.length,
      skipped: [],
      message: `Moved ${request.items.length} question.`,
      promptIds: request.items.map((item: { promptId: string }) => ({
        from: item.promptId,
        to: `${item.promptId}-moved`
      }))
    })),
    'topics:setQuestionStage': vi.fn(async (request) => ({
      changed: request.items.length,
      skipped: [],
      message: `Set the stage of ${request.items.length} question.`
    })),
    'prompts:addTargets': vi.fn(async () => questionTargets()),
    'prompts:addQuestions': vi.fn(async (request) => ({
      promptIds: request.questions.map((_q: unknown, index: number) => `copy-${index}`),
      skipped: []
    })),
    'checks:start': vi.fn(async () => ({ status: 'finished', searchesUsed: 2 })),
    'status:getCapsule': vi.fn(async () => ({ searchesLeft: 500 }))
  } as unknown as FakeEditSource
}
