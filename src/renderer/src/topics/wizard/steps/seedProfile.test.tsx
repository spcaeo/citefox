// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../ui/axe.test-helper'
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

beforeEach(resetMockStore)
afterEach(cleanup)
// Full-screen renders with axe scans: generous on a loaded machine.
vi.setConfig({ testTimeout: 30_000 })

describe('Seed step', () => {
  it('shows the seed, business, what to generate and brand and markets', async () => {
    const { client } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    const view = openWizard(client, draft.id)
    await heading('Start from a problem')
    expect(screen.getByRole('list', { name: 'Steps' })).toBeTruthy()
    expect(screen.getByLabelText('Problem or seed')).toHaveProperty(
      'value',
      'Text alerts for teams without a developer'
    )
    expect(screen.getByRole('group', { name: 'Generate' })).toBeTruthy()
    expect(screen.getByText('30 questions · about 5 per stage')).toBeTruthy()
    expect(screen.getByText('Keywords are scored apart, with their own goal.')).toBeTruthy()
    expect(footerPrimary().textContent).toMatch('Write buyer profile')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('does not write a profile until the problem is written', async () => {
    const { client, count } = recordingClient()
    const draft = await savedDraft(client, 'seed', async () => undefined, { seed: '' })
    openWizard(client, draft.id)
    await heading('Start from a problem')
    fireEvent.click(footerPrimary())
    expect(await screen.findByText('Write the problem in a few words.')).toBeTruthy()
    expect(count('topics:writeProfile')).toBe(0)
  })

  it('saves edits through topics:updateDraft and renames the topic with the seed', async () => {
    const { client, calls } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    openWizard(client, draft.id)
    await heading('Start from a problem')
    fireEvent.change(screen.getByLabelText('Problem or seed'), {
      target: { value: 'Clinic closure texts' }
    })
    expect(screen.getByLabelText('Topic name')).toHaveProperty('value', 'Clinic closure texts')
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.channel === 'topics:updateDraft' &&
            (call.request as { patch: { seed?: string } }).patch.seed === 'Clinic closure texts'
        )
      ).toBe(true)
    )
  })

  it('Custom depth shows per-stage counts and Keywords hides the question depth', async () => {
    const { client } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    openWizard(client, draft.id)
    await heading('Start from a problem')
    fireEvent.click(
      within(screen.getByRole('group', { name: 'How many buyer questions' })).getByRole('button', {
        name: 'Custom'
      })
    )
    expect(screen.getByRole('spinbutton', { name: 'Problem' })).toBeTruthy()
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Generate' })).getByRole('button', {
        name: 'Keywords'
      })
    )
    expect(screen.queryByRole('group', { name: 'How many buyer questions' })).toBeNull()
    expect(footerPrimary().textContent).toMatch('Find keywords')
    expect(screen.getByRole('list', { name: 'Steps' }).textContent).not.toMatch('Buyer profile')
  })

  it('Discover from website suggests problems; Use as seed applies one and Undo puts it back', async () => {
    const { client, calls } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    openWizard(client, draft.id)
    await heading('Start from a problem')
    pickMenu('AI actions for your business', /Discover from website/)
    expect(await lastRequest(calls, 'topics:discoverSeed')).toMatchObject({
      projectId: PROJECT.id,
      draftId: draft.id
    })
    fireEvent.click(
      await screen.findByRole('radio', { name: /Carrier email-to-text gateways shutting down/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use as seed' }))
    expect(screen.getByLabelText('Problem or seed')).toHaveProperty(
      'value',
      'Carrier email-to-text gateways shutting down'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('Problem or seed')).toHaveProperty(
      'value',
      'Text alerts for teams without a developer'
    )
  })

  it('Write buyer profile runs topics:writeProfile and opens the profile', async () => {
    const { client, calls } = recordingClient()
    const draft = await savedDraft(client, 'seed')
    openWizard(client, draft.id)
    await heading('Start from a problem')
    fireEvent.click(footerPrimary())
    expect(await lastRequest(calls, 'topics:writeProfile')).toMatchObject({ draftId: draft.id })
    await heading('Buyer profile')
  })
})

describe('Buyer profile step', () => {
  async function profileDraft(
    client: ReturnType<typeof recordingClient>['client']
  ): Promise<string> {
    const draft = await savedDraft(
      client,
      'seed',
      async (id) => {
        await client['topics:writeProfile']({ projectId: PROJECT.id, draftId: id })
      },
      { step: 'profile' }
    )
    return draft.id
  }

  it('lists points by section with sources and the saved version', async () => {
    const { client } = recordingClient()
    const view = openWizard(client, await profileDraft(client))
    await heading('Buyer profile')
    const grid = screen.getByRole('grid', { name: 'Buyer profile points' })
    expect(within(grid).getByRole('button', { name: 'Who they are' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Version 1' })).toBeTruthy()
    expect(footerPrimary().textContent).toMatch('Write questions')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Fill gaps suggests points; Apply saves a new profile version', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await profileDraft(client))
    await heading('Buyer profile')
    fireEvent.click(screen.getByRole('button', { name: 'Fill gaps' }))
    expect(await lastRequest(calls, 'topics:discoverProfileSection')).toMatchObject({
      section: null,
      action: 'discover'
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.channel === 'topics:updateDraft' &&
            'profile' in (call.request as { patch: object }).patch
        )
      ).toBe(true)
    )
    expect(await screen.findByRole('heading', { name: 'Version 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use version 1' })).toBeTruthy()
  })

  it('a section AI menu rewrites that section', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await profileDraft(client))
    await heading('Buyer profile')
    pickMenu('AI actions for Segments', /Rewrite this section/)
    expect(await lastRequest(calls, 'topics:rewriteSection')).toMatchObject({
      section: 'segments',
      mode: 'rewrite'
    })
  })

  it('Write questions generates them and opens the Questions step', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await profileDraft(client))
    await heading('Buyer profile')
    fireEvent.click(footerPrimary())
    await lastRequest(calls, 'topics:generateQuestions')
    await heading('Buyer journey questions')
  })
})
