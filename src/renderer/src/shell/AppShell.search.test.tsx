// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchQuestionsRequest, SearchQuestionsResult } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockPlaygroundClient } from '../playground/client'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { AppShell } from './AppShell'
import { SEARCH_LABEL } from './search'
import type { QuestionSearchSource } from './questionSearch'
import { SEARCH_DEBOUNCE_MS } from './useDebouncedValue'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
  window.location.hash = ''
})

/** A window wider than the sidebar's auto-collapse width. */
function wideWindow(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }) as unknown as MediaQueryList
  )
}

/** A question lookup the test answers by hand, so it can answer out of order. */
function manualQuestions(): {
  source: QuestionSearchSource
  asked: SearchQuestionsRequest[]
  answer: (index: number, result: SearchQuestionsResult) => void
} {
  const asked: SearchQuestionsRequest[] = []
  const pending: Array<(result: SearchQuestionsResult) => void> = []
  return {
    asked,
    source: {
      'search:questions': (request) => {
        asked.push(request)
        return new Promise((resolve) => pending.push(resolve))
      }
    },
    answer: (index, result) => pending[index]?.(result)
  }
}

function hit(promptId: string, text: string): SearchQuestionsResult['questions'][number] {
  return {
    promptId,
    sourceId: 'page-pricing',
    sourceKind: 'page',
    sourceName: 'Bulk SMS pricing',
    text
  }
}

function renderShell(
  client: ShellClient,
  questionSearch: QuestionSearchSource
): ReturnType<typeof render> {
  return render(
    <AppShell
      location={{ kind: 'section', section: 'settings' }}
      bridgeError={null}
      client={client}
      templatesClient={createMockTemplatesClient()}
      playgroundClient={createMockPlaygroundClient()}
      questionSearch={questionSearch}
    />
  )
}

function shellClient(): ShellClient {
  return createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore('textbolt'),
    initialFinished: true
  })
}

describe('top bar page search', () => {
  it('waits for a pause in typing before it searches pages and questions', async () => {
    wideWindow()
    const base = shellClient()
    const queries: string[] = []
    const client: ShellClient = {
      ...base,
      searchPages: (request) => {
        queries.push(request.query)
        return base.searchPages(request)
      }
    }
    const questions = manualQuestions()
    const view = renderShell(client, questions.source)
    const box = await view.findByRole('combobox', { name: SEARCH_LABEL })
    vi.useFakeTimers()
    for (const value of ['b', 'bu', 'bul', 'bulk']) {
      fireEvent.change(box, { target: { value } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
    }
    expect(queries).toEqual([])
    expect(questions.asked).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(queries).toEqual(['bulk'])
    })
    expect(questions.asked.map((request) => request.query)).toEqual(['bulk'])
    expect(questions.asked[0]?.projectId).toBeTruthy()
  })

  it('shows questions for the latest query only, and opens one in Question detail', async () => {
    wideWindow()
    const questions = manualQuestions()
    const view = renderShell(shellClient(), questions.source)
    const box = await view.findByRole('combobox', { name: SEARCH_LABEL })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'bulk' } })
    await waitFor(() => expect(questions.asked).toHaveLength(1))
    fireEvent.change(box, { target: { value: 'bulk price' } })
    await waitFor(() => expect(questions.asked).toHaveLength(2))

    // The newer answer lands first; the stale one for "bulk" must never replace it.
    await act(async () => {
      questions.answer(1, {
        questions: [hit('prompt-new', 'What does **bulk** SMS price?')],
        more: false
      })
    })
    await act(async () => {
      questions.answer(0, { questions: [hit('prompt-old', 'Stale bulk question')], more: false })
    })
    const group = await view.findByRole('group', { name: 'Questions' })
    expect(within(group).queryByText('Stale bulk question')).toBeNull()
    const option = within(group).getByRole('option', { name: /What does bulk SMS price\?/ })
    expect(option.getAttribute('href')).toBe('#/pages/page-pricing/prompt/prompt-new')
    expect(within(option).getByText('Page: Bulk SMS pricing')).toBeTruthy()

    // Arrow down to the question (past any page results) and open it with Enter.
    const options = view.getAllByRole('option')
    for (let step = 0; step < options.indexOf(option) + 1; step += 1) {
      fireEvent.keyDown(box, { key: 'ArrowDown' })
    }
    expect(box.getAttribute('aria-activedescendant')).toBe(option.id)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(window.location.hash).toBe('#/pages/page-pricing/prompt/prompt-new')
    expect((box as HTMLInputElement).value).toBe('')
  })

  it('marks only the question group when the question search fails', async () => {
    wideWindow()
    const failing: QuestionSearchSource = {
      'search:questions': () => Promise.reject(new Error('The preload bridge is missing.'))
    }
    const view = renderShell(shellClient(), failing)
    const box = await view.findByRole('combobox', { name: SEARCH_LABEL })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'bulk' } })
    expect(await view.findByText('Could not search questions.')).toBeTruthy()
    expect(view.queryByRole('alert')).toBeNull()
    expect(await view.findByRole('group', { name: 'Pages' })).toBeTruthy()
  })
})
