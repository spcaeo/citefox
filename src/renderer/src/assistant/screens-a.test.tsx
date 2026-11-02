// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Market } from '@shared/domain'
import type { CitedSiteRow } from '@shared/ipc'
import { siteRef } from '../competitors/aiContext'
import { drillAiPatch } from '../drill/aiContext'
import { shown as showQuestions } from '../questions/questions.screen.test-helper'
import { resetSuggestCache } from '../topics/list/hooks/useSuggestTopics'
import { TopicsScreen } from '../topics/list/TopicsScreen'
import { fakeTopicsSource } from '../topics/list/topics.fixtures.test-helper'
import { pageScopeRefs } from '../visibility/aiContext'
import { currentAiContext, resetAiContext, setAiBase } from './context/store'
import type { AiContextBase } from './context/types'

const BASE: AiContextBase = {
  screen: 'questions',
  screenLabel: 'Questions',
  route: '#/questions',
  crumbs: ['TextBolt', 'Questions'],
  projectId: 'proj-1',
  projectName: 'TextBolt',
  pageId: null,
  topicId: null,
  promptId: null,
  marketId: null,
  runId: null,
  filters: {}
}

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

beforeEach(() => {
  resetSuggestCache()
})

afterEach(() => {
  cleanup()
  resetAiContext()
  window.history.replaceState(null, '', '#/')
})

describe('Ask CiteFox context on the visibility screens', () => {
  test('Questions names the market and grouping, and the ticked rows become the selection', async () => {
    window.history.replaceState(null, '', '#/questions')
    setAiBase(BASE)
    const { view } = await showQuestions()
    let context = currentAiContext()
    expect(context.entities).toContainEqual({ kind: 'market', id: 'm-us', label: 'US · EN' })
    expect(context.filters.group).toBe('topic')
    expect(context.selection).toEqual([])
    // Each question row carries its own ✦ once a project is open.
    expect(view.container.querySelectorAll('[data-ai-sparkle="question"]').length).toBeGreaterThan(
      0
    )

    const tick = view.getByRole('checkbox', { name: 'Select cheapest SMS API for startups' })
    fireEvent.click(tick)
    await waitFor(() => {
      expect(currentAiContext().selection).toEqual([
        { kind: 'question', id: 'p-2', label: 'cheapest SMS API for startups' }
      ])
    })

    fireEvent.click(tick)
    await waitFor(() => expect(currentAiContext().selection).toEqual([]))
    context = currentAiContext()
    expect(context.screen).toBe('questions')
  })

  test('Topics names the market and the view, with a ✦ on each topic row', async () => {
    window.history.replaceState(null, '', '#/topics?view=list')
    setAiBase({ ...BASE, screen: 'topics', screenLabel: 'Topics', route: '#/topics' })
    const view = render(
      <TopicsScreen projectId="proj-1" source={fakeTopicsSource()} viewStore={null} />
    )
    await view.findByRole('grid', { name: 'Topics' })
    const context = currentAiContext()
    expect(context.entities).toContainEqual({ kind: 'market', id: 'm-us', label: 'US · EN' })
    expect(context.filters.view).toBe('list')
    expect(view.container.querySelectorAll('[data-ai-sparkle="topic"]').length).toBeGreaterThan(0)
  })

  test('a cited site is a competitor by name, any other site by its domain, never the own row', () => {
    const row = {
      id: 'site-1',
      name: 'SimpleTexting',
      domain: 'simpletexting.com',
      kind: 'competitor',
      tier: 'direct',
      share: 0.25
    } as CitedSiteRow
    expect(siteRef(row)).toEqual({
      kind: 'competitor',
      id: 'site-1',
      label: 'SimpleTexting',
      detail: 'Direct competitor · 25% of citations'
    })
    expect(siteRef({ ...row, kind: 'other', tier: null, name: 'reddit' })).toMatchObject({
      kind: 'domain',
      label: 'simpletexting.com'
    })
    expect(siteRef({ ...row, kind: 'you' })).toBeNull()
  })

  test('page tabs name the page, market and check; drill drawers their title and row count', () => {
    expect(
      pageScopeRefs({
        pageId: 'page-1',
        page: 'Pricing',
        market: US,
        runId: 'run-9',
        checkedAt: '2026-10-23T09:00:00.000Z'
      })
    ).toEqual([
      { kind: 'page', id: 'page-1', label: 'Pricing' },
      { kind: 'market', id: 'mkt-us', label: expect.stringContaining('US · EN') },
      { kind: 'check', id: 'run-9', label: 'Oct 23' }
    ])
    expect(pageScopeRefs({ pageId: 'page-1' })).toEqual([])

    const patch = drillAiPatch({
      title: 'Not cited',
      scope: {
        pageId: 'page-1',
        marketId: 'mkt-us',
        runId: null,
        marketLabel: 'US · EN',
        checkDateLabel: '',
        brand: 'TextBolt',
        domain: 'textbolt.com'
      },
      total: 3,
      noun: ['question', 'questions'],
      filters: { search: 'pricing' }
    })
    expect(patch).toEqual({
      screen: 'drawer.drill',
      screenLabel: 'Not cited',
      entities: [{ kind: 'market', id: 'mkt-us', label: 'US · EN' }],
      numbers: [{ label: 'Not cited', value: '3 questions' }],
      filters: { search: 'pricing' }
    })
  })
})
