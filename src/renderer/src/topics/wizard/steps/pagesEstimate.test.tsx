// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../ui/axe.test-helper'
import { MOCK_BUDGET_STORAGE_KEY } from '../mock/mockTopics'
import {
  PROJECT,
  footerPrimary,
  heading,
  lastRequest,
  openWizard,
  pickMenu,
  recordingClient,
  resetMockStore,
  savedDraft
} from '../harness.test-helper'

beforeEach(() => {
  resetMockStore()
  localStorage.removeItem(MOCK_BUDGET_STORAGE_KEY)
})
afterEach(cleanup)
// Full-screen renders with axe scans: generous on a loaded machine.
vi.setConfig({ testTimeout: 30_000 })

type Client = ReturnType<typeof recordingClient>['client']

async function matchedDraft(client: Client, step: 'pages' | 'estimate'): Promise<string> {
  const draft = await savedDraft(
    client,
    'seed',
    async (id) => {
      await client['topics:writeProfile']({ projectId: PROJECT.id, draftId: id })
      await client['topics:generateQuestions']({ projectId: PROJECT.id, draftId: id })
      await client['topics:matchPages']({ projectId: PROJECT.id, draftId: id })
    },
    { step, generate: 'questions' }
  )
  return draft.id
}

describe('Pages step', () => {
  it('groups questions by match with target pages and status', async () => {
    const { client } = recordingClient()
    const view = openWizard(client, await matchedDraft(client, 'pages'))
    await heading('Which page answers each question')
    const grid = screen.getByRole('grid', { name: 'Target pages for questions' })
    expect(within(grid).getByRole('button', { name: 'High match' })).toBeTruthy()
    expect(within(grid).getByRole('button', { name: 'No page yet' })).toBeTruthy()
    expect(await screen.findByText('Sitemap read Oct 19')).toBeTruthy()
    expect(screen.getByText(/have a target page · \d+ no page yet/)).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Confirm all high confirms the high matches through topics:setTarget', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await matchedDraft(client, 'pages'))
    await heading('Which page answers each question')
    fireEvent.click(screen.getByRole('button', { name: /Confirm all high \(\d+\)/ }))
    const request = await lastRequest(calls, 'topics:setTarget')
    expect((request.promptIds as string[]).length).toBeGreaterThan(0)
    expect(request.target).toBeUndefined()
  })

  it('a page brief offers Copy and the external writer link, which sends nothing', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await matchedDraft(client, 'pages'))
    await heading('Which page answers each question')
    pickMenu('AI actions for target pages', /Draft a brief for/)
    await lastRequest(calls, 'topics:draftPageBrief')
    const link = await screen.findByRole('link', { name: /Write with 1000AIOverviews/ })
    expect(link.getAttribute('href')).toBe('https://1000aioverviews.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('Opens another site. CiteFox sends it nothing.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy brief' })).toBeTruthy()
  })

  it('Mark no page sets an empty target; See estimate opens the estimate', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await matchedDraft(client, 'pages'))
    await heading('Which page answers each question')
    pickMenu('Actions for Q1', 'Mark no page yet')
    expect(await lastRequest(calls, 'topics:setTarget')).toMatchObject({
      target: { pageId: null, url: null }
    })
    fireEvent.click(footerPrimary())
    await heading('Estimate and start')
  })
})

describe('Estimate step', () => {
  it('shows searches needed, what is left and plans with fit chips', async () => {
    const { client, calls } = recordingClient()
    const view = openWizard(client, await matchedDraft(client, 'estimate'))
    await heading('Estimate and start')
    expect(await lastRequest(calls, 'topics:estimate')).toMatchObject({ scope: 'questions' })
    expect(
      await screen.findByRole('radio', { name: /CiteFox AI's plan: likeliest wins first/ })
    ).toHaveProperty('checked', true)
    expect(screen.getByText('Over budget')).toBeTruthy()
    expect(
      screen.getByText("Anything that doesn't fit waits for Nov 1. Nothing is lost.")
    ).toBeTruthy()
    expect(footerPrimary().textContent).toMatch(/Start: \d+ likeliest today/)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Start runs topics:start with the chosen plan and opens the topic', async () => {
    const { client, calls } = recordingClient()
    const draftId = await matchedDraft(client, 'estimate')
    openWizard(client, draftId)
    await heading('Estimate and start')
    fireEvent.click(await screen.findByRole('radio', { name: /Check one stage first/ }))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Re-check every' })).getByRole('button', {
        name: '30 days'
      })
    )
    expect(footerPrimary().textContent).toMatch('Start: check Problem')
    fireEvent.click(footerPrimary())
    const request = await lastRequest(calls, 'topics:start')
    expect(request).toMatchObject({
      draftId,
      plan: 'stage_first',
      stage: 'problem',
      intervalDays: 30,
      scope: 'questions'
    })
    await waitFor(() => expect(window.location.hash).toBe(`#/topics/topic-${draftId}`))
  })

  it('with enough searches every plan fits', async () => {
    localStorage.setItem(MOCK_BUDGET_STORAGE_KEY, 'enough')
    const { client } = recordingClient()
    openWizard(client, await matchedDraft(client, 'estimate'))
    await heading('Estimate and start')
    await screen.findByRole('radio', { name: /Check all now/ })
    expect(screen.getAllByText('Fits')).toHaveLength(4)
  })
})
