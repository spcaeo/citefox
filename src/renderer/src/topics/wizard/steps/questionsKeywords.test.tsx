// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopicDraftPatch } from '@shared/ipc'
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
  savedDraft,
  type Call
} from '../harness.test-helper'
import { generateKeywords } from './shared'

beforeEach(resetMockStore)
afterEach(cleanup)
// Full-screen renders with axe scans: generous on a loaded machine.
vi.setConfig({ testTimeout: 30_000 })

type Client = ReturnType<typeof recordingClient>['client']

async function questionsDraft(client: Client, patch: TopicDraftPatch = {}): Promise<string> {
  const draft = await savedDraft(
    client,
    'seed',
    async (id) => {
      await client['topics:writeProfile']({ projectId: PROJECT.id, draftId: id })
      await client['topics:generateQuestions']({ projectId: PROJECT.id, draftId: id })
    },
    { step: 'questions', ...patch }
  )
  return draft.id
}

function patches(calls: Call[]): TopicDraftPatch[] {
  return calls
    .filter((call) => call.channel === 'topics:updateDraft')
    .map((call) => (call.request as { patch: TopicDraftPatch }).patch)
}

describe('Questions step', () => {
  it('groups questions by stage with tabs and counts', async () => {
    const { client } = recordingClient()
    const view = openWizard(client, await questionsDraft(client))
    await heading('Buyer journey questions')
    const tabs = screen.getByRole('tablist', { name: 'Journey stages' })
    expect(within(tabs).getByRole('tab', { name: /All/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(within(tabs).getAllByRole('tab')).toHaveLength(7)
    expect(screen.getByRole('grid', { name: 'Buyer questions' })).toBeTruthy()
    expect(screen.getByText(/included · about \d+–\d+ searches per check/)).toBeTruthy()
    expect(footerPrimary().textContent).toMatch('Next: keywords')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('leaves a question out through its row menu', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await questionsDraft(client))
    await heading('Buyer journey questions')
    pickMenu('Actions for Q1', 'Leave out of the check')
    await waitFor(() =>
      expect(patches(calls).some((patch) => patch.upsertPrompts?.[0]?.included === false)).toBe(
        true
      )
    )
  })

  it('refuses a hand-written question that names the brand', async () => {
    const { client, count } = recordingClient()
    openWizard(client, await questionsDraft(client))
    await heading('Buyer journey questions')
    const before = count('topics:updateDraft')
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }))
    fireEvent.change(screen.getByLabelText("Question, in the buyer's words"), {
      target: { value: 'Is TextBolt good for clinics?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Leave your brand name out of buyer questions.')).toBeTruthy()
    expect(count('topics:updateDraft')).toBe(before)
  })

  it('Discover more suggests questions and Apply adds them; Undo removes them', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await questionsDraft(client))
    await heading('Buyer journey questions')
    pickMenu('AI actions for questions', /Discover more questions/)
    await lastRequest(calls, 'topics:discoverStageQuestions')
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(
        patches(calls).some((patch) => patch.upsertPrompts?.some((p) => p.source === 'claude'))
      ).toBe(true)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(patches(calls).some((patch) => (patch.removePromptIds?.length ?? 0) > 0)).toBe(true)
    )
  })

  it('Find gaps shows one suggestion line with Fill the gaps and Leave out overlaps', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await questionsDraft(client))
    await heading('Buyer journey questions')
    pickMenu('AI actions for questions', /Find gaps in the journey/)
    await lastRequest(calls, 'topics:findJourneyGaps')
    expect(await screen.findByText(/overlapping pairs/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Leave out overlaps' }))
    await waitFor(() =>
      expect(
        patches(calls).some((patch) => patch.upsertPrompts?.every((p) => p.included === false))
      ).toBe(true)
    )
  })

  it('goes to Pages when it writes buyer questions only (no Keywords step)', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await questionsDraft(client, { generate: 'questions' }))
    await heading('Buyer journey questions')
    expect(screen.getByRole('list', { name: 'Steps' }).textContent).not.toMatch('Keywords')
    expect(footerPrimary().textContent).toMatch('Match pages')
    fireEvent.click(footerPrimary())
    await lastRequest(calls, 'topics:matchPages')
    await heading('Which page answers each question')
  })

  it('Next: keywords generates keywords and opens Keywords and groups', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await questionsDraft(client))
    await heading('Buyer journey questions')
    fireEvent.click(footerPrimary())
    await lastRequest(calls, 'topics:discoverTerms')
    await lastRequest(calls, 'topics:generateKeywords')
    await heading('Keywords and groups')
  })
})

describe('Keywords step', () => {
  async function keywordsDraft(client: Client): Promise<string> {
    const draft = await savedDraft(
      client,
      'seed',
      async (id) => {
        await client['topics:generateQuestions']({ projectId: PROJECT.id, draftId: id })
        await generateKeywords(client, PROJECT.id, id)
      },
      { step: 'keywords' }
    )
    return draft.id
  }

  it('has Groups, All keywords and Depth settings tabs and a live summary', async () => {
    const { client, calls } = recordingClient()
    const view = openWizard(client, await keywordsDraft(client))
    await heading('Keywords and groups')
    const tabs = screen.getByRole('tablist', { name: 'Keyword views' })
    expect(
      within(tabs)
        .getByRole('tab', { name: /All keywords/ })
        .getAttribute('aria-selected')
    ).toBe('true')
    expect(screen.getByRole('grid', { name: 'Keywords' })).toBeTruthy()
    await lastRequest(calls, 'topics:keywordSummary')
    expect(await screen.findByText(/keywords need \d+–\d+ searches · you have 13/)).toBeTruthy()
    fireEvent.click(within(tabs).getByRole('tab', { name: /Groups/ }))
    expect(screen.getByRole('grid', { name: 'Keyword groups' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Depth settings presets change the keyword depth and the estimate', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await keywordsDraft(client))
    await heading('Keywords and groups')
    fireEvent.click(screen.getByRole('tab', { name: /Depth settings/ }))
    const depth = screen.getByRole('group', { name: 'How deep' })
    fireEvent.click(within(depth).getByRole('button', { name: 'Deep' }))
    expect(screen.getByText(/More synonyms, variants and long-tail/)).toBeTruthy()
    fireEvent.click(within(depth).getByRole('button', { name: 'Custom' }))
    expect(screen.getByLabelText('Max keywords')).toBeTruthy()
    await waitFor(() =>
      expect(patches(calls).some((patch) => patch.keywordDepth?.maxKeywords === 500)).toBe(true)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate keywords again' }))
    expect(await lastRequest(calls, 'topics:generateKeywords')).toMatchObject({ replace: true })
  })

  it('Merge near-duplicates lists pairs and merges them on Apply', async () => {
    const { client, calls } = recordingClient()
    openWizard(client, await keywordsDraft(client))
    await heading('Keywords and groups')
    pickMenu('AI actions for keywords', /Merge near-duplicates/)
    expect(await lastRequest(calls, 'topics:mergeNearDuplicates')).toMatchObject({ apply: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Merge pairs' }))
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.channel === 'topics:mergeNearDuplicates' && (c.request as { apply: boolean }).apply
        )
      ).toBe(true)
    )
  })
})
