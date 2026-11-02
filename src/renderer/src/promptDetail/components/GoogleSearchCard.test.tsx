// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PromptGoogleSearch } from '@shared/domain'
import type { AddQuestionsRequest, QuestionsUpdateRequest } from '@shared/ipc'
import type { QuestionEditSource } from '../../questionEdit'
import { UndoToastHost } from '../../ui'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { GoogleSearchCard } from './GoogleSearchCard'

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

const PAGE = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const TARGET = { id: 'page-1', name: 'Alerts' }

function google(patch: Partial<PromptGoogleSearch> = {}): PromptGoogleSearch {
  return {
    ownRank: { position: 3, url: PAGE, thisPage: true },
    hasResults: true,
    questions: [
      { text: 'Can I send text alerts to employees for free?', trackable: true },
      { text: 'Which plan covers scheduled texts?', trackable: false }
    ],
    ...patch
  }
}

function fakeSource(): QuestionEditSource & {
  adds: AddQuestionsRequest[]
  updates: QuestionsUpdateRequest[]
} {
  const adds: AddQuestionsRequest[] = []
  const updates: QuestionsUpdateRequest[] = []
  return {
    adds,
    updates,
    'prompts:addQuestions': async (request: AddQuestionsRequest) => {
      adds.push(request)
      return {
        pageId: request.pageId,
        promptIds: ['prompt-new'],
        skipped: [],
        version: 2,
        savedAt: '2026-10-24T09:00:00.000Z'
      }
    },
    'questions:update': async (request: QuestionsUpdateRequest) => {
      updates.push(request)
      return { changed: 1, skipped: [], message: 'Removed 1 question.', restore: [] }
    }
  } as unknown as QuestionEditSource & {
    adds: AddQuestionsRequest[]
    updates: QuestionsUpdateRequest[]
  }
}

function card(value: PromptGoogleSearch, source = fakeSource()): ReturnType<typeof render> {
  return render(
    <>
      <GoogleSearchCard google={value} projectId="proj-1" target={TARGET} source={source} />
      <UndoToastHost />
    </>
  )
}

describe('Google search card on the question page', () => {
  it('says where this page ranks and lists People also ask', () => {
    card(google())
    expect(screen.getByRole('region', { name: 'Google search' })).toBeTruthy()
    expect(screen.getByTestId('pd-google-rank').textContent).toBe(
      "Your page ranks #3 in Google's results."
    )
    const list = screen.getByRole('list', { name: 'People also ask on Google' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    // Only the question that passes the buyer prompt checks gets Track.
    expect(within(list).getAllByRole('button', { name: /^Track: / })).toHaveLength(1)
    expect(
      screen.getByRole('link', { name: 'Reword them in Add questions' }).getAttribute('href')
    ).toMatch(/drawer=add-questions.*target=page-1.*tab=suggest/u)
  })

  it('names another own page, and says when the site is not in the top 10', () => {
    const { unmount } = card(
      google({ ownRank: { position: 1, url: 'https://textbolt.com/pricing/', thisPage: false } })
    )
    expect(screen.getByTestId('pd-google-rank').textContent).toContain(
      "Another of your pages ranks #1 in Google's results"
    )
    expect(screen.getByText('textbolt.com/pricing/')).toBeTruthy()
    unmount()
    card(google({ ownRank: null, questions: [] }))
    expect(screen.getByTestId('pd-google-rank').textContent).toBe(
      "Not in the top 10 of Google's results."
    )
    expect(screen.queryByRole('list', { name: 'People also ask on Google' })).toBeNull()
  })

  it('is hidden when the stored searches hold neither', () => {
    const { container } = card(google({ ownRank: null, hasResults: false, questions: [] }))
    expect(container.querySelector('.pd2-card')).toBeNull()
  })

  it('shows People also ask without a rank line when Google results were not kept', () => {
    card(google({ ownRank: null, hasResults: false }))
    expect(screen.queryByTestId('pd-google-rank')).toBeNull()
    expect(screen.getByRole('list', { name: 'People also ask on Google' })).toBeTruthy()
  })

  it('Track adds the question to the page at once, with Undo', async () => {
    const source = fakeSource()
    card(google(), source)
    fireEvent.click(
      screen.getByRole('button', { name: 'Track: Can I send text alerts to employees for free?' })
    )
    await waitFor(() => expect(source.adds).toHaveLength(1))
    expect(source.adds[0]).toEqual({
      projectId: 'proj-1',
      pageId: 'page-1',
      questions: [{ text: 'Can I send text alerts to employees for free?' }]
    })
    const toast = await screen.findByTestId('undo-toast')
    expect(toast.textContent).toContain('Added 1 question to Alerts.')
    // The tracked question leaves the list.
    await waitFor(() =>
      expect(screen.queryByText('Can I send text alerts to employees for free?')).toBeNull()
    )
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(source.updates).toHaveLength(1))
    expect(source.updates[0]).toEqual({
      projectId: 'proj-1',
      action: 'remove',
      items: [{ sourceId: 'page-1', promptId: 'prompt-new' }]
    })
  })
})
