// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ClaudeStatus } from '@shared/ipc'
import { PermissionsContext, type PermissionsContextValue } from '../../ui/permissionsContext'
import { TopicWizard } from '.'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../ui/axe.test-helper'
import {
  PROJECT,
  heading,
  lastRequest,
  openWizard,
  recordingClient,
  resetMockStore,
  savedDraft
} from './harness.test-helper'

beforeEach(resetMockStore)
afterEach(cleanup)
// Full-screen renders with axe scans: generous on a loaded machine.
vi.setConfig({ testTimeout: 30_000 })

describe('What do you want to track?', () => {
  it('offers the same six ways as How do you want to start, Search Console coming later', async () => {
    const { client } = recordingClient()
    const view = openWizard(client, null)
    await heading('What do you want to track?')
    const group = screen.getByRole('radiogroup', { name: 'Starting point' })
    // One shared list: the start chooser's six ways, in the same order.
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent ?? '')
        .map((text) =>
          text.split('e.g.')[0]?.split('Until then')[0]?.replace('Coming later', '').trim()
        )
    ).toEqual([
      'A page URL',
      'A problem or seed',
      'Keywords & groups',
      'My own questions',
      "A competitor's page",
      'Search Console'
    ])
    expect(within(group).getByRole('radio', { name: /Search Console/ })).toHaveProperty(
      'disabled',
      true
    )
    expect(within(group).getByRole('radio', { name: /A problem or seed/ })).toHaveProperty(
      'checked',
      true
    )
    expect(screen.getByText('Coming later')).toBeTruthy()
    expect(await screen.findByText('“Text alerts for teams without a developer”')).toBeTruthy()
    expect(screen.getByText(/of your pages already cover parts of it/)).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Continue creates a seed draft and opens it', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, null)
    await heading('What do you want to track?')
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    const request = await lastRequest(calls, 'topics:createDraft')
    expect(request).toMatchObject({ projectId: 'p1', path: 'seed' })
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/add\/draft-/))
  })

  it('Keywords & groups starts the seed path set to keywords', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, null)
    await heading('What do you want to track?')
    fireEvent.click(screen.getByRole('radio', { name: /Keywords & groups/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(await lastRequest(calls, 'topics:createDraft')).toMatchObject({ path: 'seed' })
    expect(await lastRequest(calls, 'topics:updateDraft')).toMatchObject({
      patch: { generate: 'keywords' }
    })
  })

  it('A page URL routes to the existing Add page flow without a draft', async () => {
    const { client, count } = recordingClient()
    openWizard(client, null)
    await heading('What do you want to track?')
    fireEvent.click(screen.getByRole('radio', { name: /A page URL/ }))
    fireEvent.click(screen.getByRole('button', { name: /Open Add a page/ }))
    expect(window.location.hash).toBe('#/add-page')
    expect(count('topics:createDraft')).toBe(0)
  })

  it('My own questions, a competitor page and the suggested start each start their path', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, null)
    await heading('What do you want to track?')
    fireEvent.click(screen.getByRole('radio', { name: /My own questions/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(await lastRequest(calls, 'topics:createDraft')).toMatchObject({ path: 'questions' })

    fireEvent.click(screen.getByRole('radio', { name: /A competitor's page/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() =>
      expect(calls.filter((c) => c.channel === 'topics:createDraft').at(-1)?.request).toMatchObject(
        { path: 'competitor' }
      )
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Use this start' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.channel === 'topics:createDraft').at(-1)?.request).toMatchObject(
        {
          path: 'seed',
          seed: 'Text alerts for teams without a developer'
        }
      )
    )
  })

  it('shows a one-line example under each option, from the saved profile', async () => {
    const { client } = recordingClient()
    openWizard(client, null)
    await heading('What do you want to track?')
    const group = screen.getByRole('radiogroup', { name: 'Starting point' })
    expect(within(group).getByText('https://textbolt.com/pricing')).toBeTruthy()
    expect(within(group).getByText(/paste lines from sales calls/)).toBeTruthy()
    expect(within(group).getByText('e.g. a rival’s pricing or compare page')).toBeTruthy()
    // The saved suggested seed becomes the seed example once it loads.
    expect(
      await within(group).findByText('e.g. “Text alerts for teams without a developer”')
    ).toBeTruthy()
    expect(screen.getByText('Let CiteFox set up your site')).toBeTruthy()
  })

  it('offers "Change how to start" once a choice is remembered', async () => {
    localStorage.setItem('citefox.startChoice.p1', 'self')
    const { client } = recordingClient()
    openWizard(client, null)
    await heading('What do you want to track?')
    expect(screen.getByRole('link', { name: 'Change how to start' }).getAttribute('href')).toBe(
      '#/start/choose'
    )
    fireEvent.click(screen.getByRole('link', { name: 'Set up my site' }))
    expect(localStorage.getItem('citefox.startChoice.p1')).toBe('autopilot')
    localStorage.removeItem('citefox.startChoice.p1')
  })

  it('lists unfinished drafts to pick up again', async () => {
    const { client } = recordingClient()
    const draft = await savedDraft(client, 'seed', async () => undefined, {
      name: 'Clinic closures'
    })
    openWizard(client, null)
    fireEvent.click(await screen.findByRole('button', { name: 'Clinic closures' }))
    expect(window.location.hash).toBe(`#/add/${draft.id}`)
  })
})

describe('the suggested start never runs CiteFox AI on its own when CiteFox AI is not ready', () => {
  it('skips the call and offers Connect an AI instead', async () => {
    const { client, count } = recordingClient()
    const claude: ClaudeStatus = {
      connection: 'claude-code',
      state: 'needs_setup',
      name: 'CiteFox AI',
      summary: 'not found',
      plan: null,
      model: null,
      checkedAt: null,
      fresh: false,
      nextStep: 'Install CiteFox AI.'
    }
    const value = {
      snapshot: null,
      claude,
      loading: false,
      error: null,
      checking: false,
      progress: null,
      steps: {},
      busy: null,
      message: null,
      refresh: async () => null,
      checkClaude: async () => claude,
      ensureClaude: async () => claude,
      request: async () => null
    } satisfies PermissionsContextValue
    render(
      <PermissionsContext.Provider value={value}>
        <TopicWizard project={PROJECT} draftId={null} client={client} />
      </PermissionsContext.Provider>
    )
    await heading('What do you want to track?')
    const connect = await screen.findByRole('link', { name: 'Connect an AI' })
    expect(connect.getAttribute('href')).toBe('#/connections?tab=claude')
    expect(screen.getByText(/once CiteFox AI is connected/)).toBeTruthy()
    await waitFor(() => expect(count('topics:listDrafts')).toBe(1))
    expect(count('topics:suggestedStart')).toBe(0)
  })
})
