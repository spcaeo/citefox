// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AllPagesData, AssistantAction } from '@shared/ipc'
import { buildPlan, planSummary } from '../../checkNow/model'
import { fakeSource, NOW, OPTIONS, scopePage } from '../../checkNow/fixtures.test-helper'
import type { AssistantClient } from '../client'
import { ActionCard } from './ActionCard'
import { checkCost } from './checkCost'

const CHECK: AssistantAction = {
  id: 'start-check-1',
  kind: 'start-check',
  title: 'Check 2 questions again',
  detail: '2 questions in 2 markets · results land in Check history',
  pageId: 'a',
  topicId: null,
  promptIds: ['q1', 'q2'],
  marketIds: ['mkt-us', 'mkt-uk'],
  questions: [],
  name: null,
  targetPageId: null,
  searches: 4,
  drill: null
}

async function pagesData(options = OPTIONS): Promise<AllPagesData> {
  return (await fakeSource(options)['allpages:list']({ projectId: 'p1' })) as AllPagesData
}

function client(data: AllPagesData | null): AssistantClient {
  return {
    ask: vi.fn(),
    addQuestions: vi.fn(),
    draftTopicFix: vi.fn(),
    runAssist: vi.fn(),
    setTarget: vi.fn(),
    startCheck: vi.fn(),
    listPages: vi.fn(async () => data)
  } as unknown as AssistantClient
}

afterEach(cleanup)

describe('the cost of a "start a check" card', () => {
  it('uses the Check now model: questions × markets × samples, up to twice that, and what is left', async () => {
    const cost = checkCost(CHECK, await pagesData())
    expect(cost?.estimate).toEqual({ min: 4, max: 8, pages: 1 })
    expect(cost?.line).toBe('About 4–8 searches · 500 left this month')
    expect(cost?.tooMany).toBe(false)
    // The same numbers the Check now drawer shows for the same pick.
    const plan = buildPlan({
      state: {
        scope: { kind: 'pages', ids: ['a'] },
        markets: ['mkt-us', 'mkt-uk'],
        only: 'picked',
        prompts: ['q1', 'q2'],
        q: ''
      },
      options: OPTIONS,
      now: NOW,
      notCited: null,
      pageQuestions: null
    })
    expect(planSummary(plan, OPTIONS)).toContain(cost?.line ?? 'missing')
  })

  it('counts a page with two samples twice and warns when it may not fit', async () => {
    const tight = {
      ...OPTIONS,
      searchesLeft: 6,
      pages: [scopePage('a', { samples: 2, marketIds: ['mkt-us', 'mkt-uk'] })]
    }
    const cost = checkCost(CHECK, await pagesData(tight))
    expect(cost?.estimate).toEqual({ min: 8, max: 16, pages: 1 })
    expect(cost?.line).toBe('About 8–16 searches · only 6 left this month')
    expect(cost?.tooMany).toBe(true)
  })

  it('prices a topic as its own subject in the picked markets', async () => {
    const cost = checkCost({ ...CHECK, pageId: 't1' }, await pagesData())
    expect(cost?.estimate).toEqual({ min: 4, max: 8, pages: 1 })
  })

  it('shows the cost and searches left on the card, and blocks a check that cannot fit', async () => {
    const tight = { ...OPTIONS, searchesLeft: 3 }
    render(<ActionCard action={CHECK} projectId="p1" client={client(await pagesData(tight))} />)
    await waitFor(() =>
      expect(screen.getByTestId('asst-action-cost').textContent).toBe(
        'Uses about 4–8 searches · only 3 left this month'
      )
    )
    expect(screen.getByRole('alert').textContent).toContain('Not enough searches left')
    expect((screen.getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('falls back to the plain line when the pages cannot be read', async () => {
    render(<ActionCard action={CHECK} projectId="p1" client={client(null)} />)
    expect(screen.getByTestId('asst-action-cost').textContent).toBe(
      'Uses 4 searches of your search key.'
    )
    expect((screen.getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })
})
