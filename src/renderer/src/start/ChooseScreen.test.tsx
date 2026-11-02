// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult
} from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteStartPlan, StartProgress } from '@shared/ipc'
import { recordingClient, resetMockStore } from '../topics/wizard/harness.test-helper'
import { axeViolations } from '../ui/axe.test-helper'
import { resetActivityFeed } from './activity'
import { readStartChoice, saveStartChoice } from './choice'
import { noteProjectCreated } from './createdNotice'
import { ChooseScreen } from './ChooseScreen'
import { fakeStartClient } from './fakeStartClient.test-helper'
import { SetupScreen } from './SetupScreen'

const PROJECT = {
  id: 'p1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  brandNames: ['TextBolt'],
  competitors: ['simpletexting.com', 'twilio.com'],
  switchingFrom: []
}

beforeEach(() => {
  resetMockStore()
  resetActivityFeed()
  localStorage.removeItem('citefox.startChoice.p1')
  window.location.hash = '#/start/choose'
})
afterEach(cleanup)
vi.setConfig({ testTimeout: 30_000 })

function open(options: { client?: ReturnType<typeof fakeStartClient> } = {}): {
  view: RenderResult
  calls: ReturnType<typeof recordingClient>['calls']
} {
  const client = options.client ?? fakeStartClient()
  const topics = recordingClient()
  const view = render(
    <ChooseScreen client={client} project={PROJECT} searchesLeft={212} topics={topics.client} />
  )
  return { view, calls: topics.calls }
}

describe('How do you want to start?', () => {
  it('offers two equal choices with examples from the profile, and passes axe', async () => {
    const { view } = open()
    expect(
      screen.getByRole('heading', { level: 1, name: 'How do you want to start?' })
    ).toBeTruthy()
    const auto = screen.getByRole('radio', { name: 'Let CiteFox set up my site' })
    const self = screen.getByRole('radio', { name: 'I’ll choose what to track myself' })
    // Recommended is preselected; one primary button.
    expect(auto).toHaveProperty('checked', true)
    expect(self).toHaveProperty('checked', false)
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.getByText('Free · about a minute · no searches')).toBeTruthy()
    expect(screen.getByText('Reads textbolt.com and its sitemap')).toBeTruthy()
    expect(screen.getByText(/such as simpletexting\.com and twilio\.com/)).toBeTruthy()
    const ways = screen.getByRole('group', { name: 'Way to start (optional)' })
    expect(within(ways).getAllByRole('radio')).toHaveLength(6)
    expect(within(ways).getByText('https://textbolt.com/pricing')).toBeTruthy()
    expect(within(ways).getByText('https://simpletexting.com/pricing')).toBeTruthy()
    expect(within(ways).getByRole('radio', { name: /Search Console/ })).toHaveProperty(
      'disabled',
      true
    )
    expect(document.querySelectorAll('.ui-btn-primary')).toHaveLength(1)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Let CiteFox set up my site goes to setup and is remembered', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(window.location.hash).toBe('#/start/setup')
    expect(readStartChoice('p1')).toBe('autopilot')
  })

  it("I'll choose myself opens the chooser and is remembered", async () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'I’ll choose what to track myself' }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/add'))
    expect(readStartChoice('p1')).toBe('self')
  })

  it('picking a way goes straight to that path', async () => {
    const { calls } = open()
    fireEvent.click(screen.getByRole('radio', { name: /My own questions/ }))
    expect(screen.getByRole('radio', { name: 'I’ll choose what to track myself' })).toHaveProperty(
      'checked',
      true
    )
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/add\/draft-/))
    expect(calls.find((call) => call.channel === 'topics:createDraft')?.request).toMatchObject({
      projectId: 'p1',
      path: 'questions'
    })
  })

  it('Keywords & groups starts the seed path set to keywords; a page URL opens Add page', async () => {
    const { calls } = open()
    fireEvent.click(screen.getByRole('radio', { name: /Keywords & groups/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/add\/draft-/))
    expect(calls.find((call) => call.channel === 'topics:createDraft')?.request).toMatchObject({
      path: 'seed'
    })
    expect(calls.find((call) => call.channel === 'topics:updateDraft')?.request).toMatchObject({
      patch: { generate: 'keywords' }
    })
    cleanup()
    open()
    fireEvent.click(screen.getByRole('radio', { name: /A page URL/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/add-page'))
  })

  it('opens on the remembered choice, so coming back here changes it', () => {
    saveStartChoice('p1', 'self')
    open()
    expect(screen.getByRole('radio', { name: 'I’ll choose what to track myself' })).toHaveProperty(
      'checked',
      true
    )
  })

  it('stops a setup that is already running before opening the chooser', async () => {
    const stop = vi.fn(() => Promise.resolve(null))
    const client = fakeStartClient({
      overrides: {
        progress: () =>
          Promise.resolve({
            projectId: 'p1',
            phase: 'running',
            items: [],
            startedAt: '2026-10-22T10:00:00.000Z',
            elapsedMs: 0,
            etaSeconds: null,
            message: null,
            known: {}
          } as unknown as StartProgress),
        stop
      }
    })
    open({ client })
    fireEvent.click(screen.getByRole('radio', { name: 'I’ll choose what to track myself' }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/add'))
    expect(stop).toHaveBeenCalledWith({ projectId: 'p1' })
  })
})

describe('Setup screen', () => {
  it('"Skip, I\'ll set it up myself" stops setup and opens the chooser', async () => {
    const stop = vi.fn(() => Promise.resolve(null))
    const client = fakeStartClient({ overrides: { stop } })
    render(<SetupScreen client={client} project={PROJECT} searchesLeft={212} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Setup actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Skip, I’ll set it up myself' }))
    await waitFor(() => expect(window.location.hash).toBe('#/add'))
    expect(stop).toHaveBeenCalled()
    expect(readStartChoice('p1')).toBe('self')
  })

  it('starts reading the site once under StrictMode (dev mounts twice)', async () => {
    const homework = vi.fn(() => new Promise<SiteStartPlan>(() => {}))
    const client = fakeStartClient({ overrides: { homework } })
    render(
      <StrictMode>
        <SetupScreen client={client} project={PROJECT} searchesLeft={212} />
      </StrictMode>
    )
    await waitFor(() => expect(homework).toHaveBeenCalledTimes(1))
    expect(homework).toHaveBeenCalledWith({ projectId: 'p1' })
  })
})

describe('right after New project → Create', () => {
  it('says the new project is ready, once', () => {
    noteProjectCreated('Harbor')
    open()
    expect(screen.getByText(/Harbor is ready\./).closest('[role="status"]')).toBeTruthy()
    cleanup()
    open()
    expect(screen.queryByText(/Harbor is ready/)).toBeNull()
  })
})
