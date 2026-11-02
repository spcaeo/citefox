// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../ui/axe.test-helper'
import { FIXTURE_COMPETITOR_URL, FIXTURE_IMPORT_CSV, FIXTURE_IMPORT_PASTE } from '../mock/fixture'
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

describe('My own questions', () => {
  it('needs pasted lines or a CSV before clean-up', async () => {
    const { client, count } = recordingClient()
    const draft = await savedDraft(client, 'questions')
    const view = openWizard(client, draft.id)
    await heading('Add your own questions')
    expect(screen.getByRole('list', { name: 'Steps' }).textContent).toMatch('Clean up')
    fireEvent.click(footerPrimary())
    expect(await screen.findByText('Paste questions or choose a CSV file.')).toBeTruthy()
    expect(count('topics:importQuestions')).toBe(0)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('reads a CSV, offers the column picker and imports pasted lines with it', async () => {
    const { client, calls } = recordingClient()
    const draft = await savedDraft(client, 'questions')
    openWizard(client, draft.id)
    await heading('Add your own questions')
    fireEvent.change(screen.getByLabelText('One question per line'), {
      target: { value: FIXTURE_IMPORT_PASTE }
    })
    const file = new File([FIXTURE_IMPORT_CSV], 'sales-and-support-questions.csv', {
      type: 'text/csv'
    })
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } })
    await lastRequest(calls, 'topics:readCsvColumns')
    expect(await screen.findByLabelText('Question column')).toHaveProperty('value', '0')
    expect(screen.getByLabelText('Source (optional)')).toHaveProperty('value', '1')
    fireEvent.click(footerPrimary())
    const request = await lastRequest(calls, 'topics:importQuestions')
    expect(request).toMatchObject({
      text: FIXTURE_IMPORT_PASTE,
      csv: {
        fileName: 'sales-and-support-questions.csv',
        mapping: { question: 0, source: 1, hasHeader: true }
      }
    })
    await screen.findByRole('grid', { name: 'Imported questions' })
  })

  it('the clean-up preview flags brand and short lines and CiteFox AI cleans up on Apply', async () => {
    const { client, calls } = recordingClient()
    const draft = await savedDraft(
      client,
      'questions',
      async (id) => {
        await client['topics:importQuestions']({
          projectId: PROJECT.id,
          draftId: id,
          text: FIXTURE_IMPORT_PASTE
        })
      },
      { step: 'cleanup' }
    )
    const view = openWizard(client, draft.id)
    await screen.findByRole('grid', { name: 'Imported questions' })
    expect(screen.getByText(/1 duplicates merged/)).toBeTruthy()
    expect(screen.getAllByText('Brand question').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Very short').length).toBeGreaterThan(0)
    expect(await axeViolations(view.container)).toEqual([])
    pickMenu('AI actions for imported questions', /Clean up and tag/)
    await lastRequest(calls, 'topics:cleanupWithClaude')
    fireEvent.click(await screen.findByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByText(/lines cleaned/)).toBeTruthy()
    fireEvent.click(footerPrimary())
    await lastRequest(calls, 'topics:matchPages')
    await heading('Which page answers each question')
  })
})

describe("A competitor's page", () => {
  it('asks for their URL, reads it once and shows their page', async () => {
    const { client, calls, count } = recordingClient()
    const draft = await savedDraft(client, 'competitor')
    const view = openWizard(client, draft.id)
    await heading("Track a competitor's page")
    fireEvent.change(screen.getByLabelText('Their page URL'), { target: { value: 'not a url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Read their page' }))
    expect(await screen.findByText(/starting with https:\/\//)).toBeTruthy()
    expect(count('topics:readCompetitorPage')).toBe(0)
    fireEvent.change(screen.getByLabelText('Their page URL'), {
      target: { value: FIXTURE_COMPETITOR_URL }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Read their page' }))
    expect(await lastRequest(calls, 'topics:readCompetitorPage')).toMatchObject({
      url: FIXTURE_COMPETITOR_URL
    })
    expect(
      await screen.findByText('Business SMS alerts: send urgent texts to staff and customers')
    ).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('writes questions from their page, shows claims, then matches my pages', async () => {
    const { client, calls } = recordingClient()
    const draft = await savedDraft(client, 'competitor', async (id) => {
      await client['topics:readCompetitorPage']({
        projectId: PROJECT.id,
        draftId: id,
        url: FIXTURE_COMPETITOR_URL
      })
    })
    openWizard(client, draft.id)
    await heading("Track a competitor's page")
    fireEvent.click(footerPrimary())
    expect(await lastRequest(calls, 'topics:competitorQuestions')).toMatchObject({ marketId: 'us' })
    await screen.findByRole('grid', { name: 'Questions from their page' })
    expect(screen.getByRole('heading', { name: "5 claims you don't make" })).toBeTruthy()
    expect(screen.getByText(/Read · 2,140 words/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }))
    expect(screen.getByText('Free trial with no card')).toBeTruthy()
    fireEvent.click(footerPrimary())
    await lastRequest(calls, 'topics:matchPages')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        'Which page answers each question'
      )
    )
  })
})
