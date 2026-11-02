// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { TEXTBOLT_TOPIC_ID, TEXTBOLT_TOPIC_PROJECT_ID } from '@shared/fixtures/textbolt-topic'
import type { SuggestTopicTargetResult, TopicTargetRequest } from '@shared/ipc'
import { DrillHost } from '../../drill'
import { axeViolations } from '../../ui/axe.test-helper'
import { TopicResultsScreen } from '.'
import { citedChips, suggestedRows } from './model/suggested'
import { createMockTopicResultsSource } from './source/mock'
import { mockSuggestTarget, mockTargetSuggestions } from './source/mockTargets'
import type { TopicResultsSource } from './source'

const ALERTS = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business'

/** The mock topic on textbolt.com, with its saved target and the AI reply set per test. */
function makeSource(options: {
  target?: string | null
  ai?: () => Promise<SuggestTopicTargetResult>
  calls?: TopicTargetRequest[]
}): TopicResultsSource {
  const source = createMockTopicResultsSource()
  return {
    ...source,
    results: async (request) => {
      const results = await source.results(request)
      return {
        ...results,
        topic: {
          ...results.topic,
          domain: 'textbolt.com',
          targetPage: options.target ?? results.topic.targetPage
        }
      }
    },
    targetSuggestions: async (request) => {
      options.calls?.push(request)
      return mockTargetSuggestions(request.topicId)
    },
    suggestTarget: async (request) => {
      options.calls?.push(request)
      return (options.ai ?? (async () => mockSuggestTarget()))()
    }
  }
}

function renderDrawer(source: TopicResultsSource): ReturnType<typeof render> {
  window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}?drawer=topic-page`
  return render(
    <DrillHost>
      <TopicResultsScreen
        projectId={TEXTBOLT_TOPIC_PROJECT_ID}
        projectName="TextBolt"
        topicId={TEXTBOLT_TOPIC_ID}
        viewStore={null}
        source={source}
      />
    </DrillHost>
  )
}

beforeEach(() => {
  window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}`
})

afterEach(cleanup)

describe('target page suggestions', () => {
  test('lists the cited pages with their counts; Use this page fills the field', async () => {
    const calls: TopicTargetRequest[] = []
    const view = renderDrawer(makeSource({ target: `${ALERTS}/`, calls }))
    const drawer = await view.findByRole('dialog', { name: 'Target page' })
    const list = await within(drawer).findByRole('list', { name: 'Suggested pages' })
    expect(calls[0]).toMatchObject({ topicId: TEXTBOLT_TOPIC_ID, marketId: 'mkt-us' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    const first = rows[0] as HTMLElement
    expect(within(first).getByText('How to set up text alerts for business')).toBeTruthy()
    expect(within(first).getByText('Cited for 17 of 146 questions and keywords')).toBeTruthy()
    expect(within(first).getByText('Google 14')).toBeTruthy()
    expect(within(first).getByText('ChatGPT 4')).toBeTruthy()
    expect(within(first).getByText('best #1')).toBeTruthy()
    // The saved target, written with a trailing slash, is the same page.
    expect(within(first).getByText('Current target')).toBeTruthy()
    expect(within(first).getByRole('button', { name: /^Selected/u })).toBeTruthy()
    expect(
      within(first).getByRole('button', { name: `Copy ${new URL(ALERTS).pathname}` })
    ).toBeTruthy()
    // A target is set: nothing is preselected.
    expect(within(drawer).queryByTestId('target-pick-note')).toBeNull()

    const pricing = rows[1] as HTMLElement
    expect(within(first).getByText('Tracked')).toBeTruthy()
    expect(within(pricing).queryByText('Tracked')).toBeNull()
    fireEvent.click(within(pricing).getByRole('button', { name: 'Use this page /pricing' }))
    const field = within(drawer).getByLabelText('Target page') as HTMLInputElement
    expect(field.value).toBe('https://textbolt.com/pricing')
    expect(
      (within(drawer).getByRole('button', { name: 'Save target page' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  })

  test('✦ Suggest with AI adds CiteFox AI picks with reasons and a new page idea', async () => {
    const view = renderDrawer(makeSource({ target: 'https://textbolt.com/pricing' }))
    const drawer = await view.findByRole('dialog', { name: 'Target page' })
    await within(drawer).findByRole('list', { name: 'Suggested pages' })
    expect(within(drawer).getByText(/CiteFox AI · about 12 s · no searches/u)).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Suggest with AI' }))

    const note = await within(drawer).findByTestId('target-ai-note')
    expect(note.textContent).toBe('CiteFox AI · about 9 s · no searches')
    const rows = within(within(drawer).getByRole('list', { name: 'Suggested pages' })).getAllByRole(
      'listitem'
    )
    // The AI's picks lead, in its order, each with its reason; the cited counts stay.
    expect(rows[0]?.textContent).toContain('CiteFox AI pick 1')
    expect(rows[0]?.textContent).toContain('Its headings walk a small team')
    expect(rows[0]?.textContent).toContain('Cited for 17 of 146')
    expect(rows[1]?.textContent).toContain('IT alerts by text')
    expect(rows[1]?.textContent).toContain('It is about the on-call IT buyer')
    expect(rows[2]?.textContent).toContain('TextBolt pricing')
    expect(rows[2]?.textContent).toContain('Current target')

    const idea = within(drawer).getByTestId('target-new-page')
    expect(idea.textContent).toContain('Or write a new page:')
    expect(idea.textContent).toContain('Replacing a carrier email-to-text gateway')
    expect(within(idea).getByRole('link', { name: /Write with 1000AIOverviews/u })).toBeTruthy()
    fireEvent.click(
      within(idea).getByRole('button', {
        name: 'Use this path /email-to-text-gateway-replacement'
      })
    )
    const field = within(drawer).getByLabelText('Target page') as HTMLInputElement
    expect(field.value).toBe('/email-to-text-gateway-replacement')
    expect(within(drawer).getByRole('button', { name: 'Suggest again' })).toBeTruthy()

    // Customers see CiteFox AI, never the provider behind it.
    expect(drawer.textContent).not.toMatch(/Claude|cloro|Codex|SerpApi/u)
    expect(await axeViolations(drawer)).toEqual([])
  })

  test('a failed AI call keeps the cited list and offers Try again', async () => {
    let fail = true
    const view = renderDrawer(
      makeSource({
        target: 'https://textbolt.com/pricing',
        ai: async () => {
          if (fail) throw new Error('CiteFox AI hit its usage limit. It resumes at 3 pm.')
          return mockSuggestTarget()
        }
      })
    )
    const drawer = await view.findByRole('dialog', { name: 'Target page' })
    await within(drawer).findByRole('list', { name: 'Suggested pages' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Suggest with AI' }))
    const alert = await within(drawer).findByRole('alert')
    expect(alert.textContent).toContain('usage limit')
    expect(within(drawer).getByRole('list', { name: 'Suggested pages' })).toBeTruthy()
    fail = false
    fireEvent.click(within(drawer).getByRole('button', { name: 'Try again' }))
    await within(drawer).findByTestId('target-ai-note')
    expect(within(drawer).queryByRole('alert')).toBeNull()
  })

  test('closing an untouched preselection does not ask to discard it', async () => {
    const view = renderDrawer(makeSource({ target: null }))
    const drawer = await view.findByRole('dialog', { name: 'Target page' })
    await within(drawer).findByTestId('target-pick-note')
    const selected = within(drawer).getAllByRole('button', { name: /^Selected/u })
    expect(selected).toHaveLength(1)
    expect(await axeViolations(drawer)).toEqual([])
    fireEvent.click(within(drawer).getByRole('button', { name: /^Close/u }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
  })
})

describe('suggested rows', () => {
  test('AI picks lead and merge with their cited page; chips read in plain words', () => {
    const cited = mockTargetSuggestions(TEXTBOLT_TOPIC_ID)
    const rows = suggestedRows(cited, {
      ...mockSuggestTarget(),
      picks: [
        { url: 'https://textbolt.com/use-cases/it-alerts/', title: null, reason: 'Fits.' },
        { url: 'https://textbolt.com/new-guide', title: 'New guide', reason: 'Fits too.' }
      ]
    })
    expect(rows.map((row) => [row.url, row.aiRank, row.cited?.citedPrompts ?? null])).toEqual([
      ['https://textbolt.com/use-cases/it-alerts/', 1, 3],
      ['https://textbolt.com/new-guide', 2, null],
      [ALERTS, null, 17],
      ['https://textbolt.com/pricing', null, 4],
      ['https://textbolt.com/blog/carrier-email-to-text-shutdown', null, 2]
    ])
    expect(rows[0]?.title).toBe('IT alerts by text')
    const first = cited.suggestions[0]
    if (first === undefined) throw new Error('no suggestion')
    expect(citedChips(first, cited)).toEqual([
      'Cited for 17 of 146 questions and keywords',
      'Google 14',
      'ChatGPT 4',
      'best #1'
    ])
  })
})
