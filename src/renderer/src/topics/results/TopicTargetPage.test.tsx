// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { TEXTBOLT_TOPIC_ID, TEXTBOLT_TOPIC_PROJECT_ID } from '@shared/fixtures/textbolt-topic'
import { DrillHost } from '../../drill'
import { axeViolations } from '../../ui/axe.test-helper'
import { TopicResultsScreen } from '.'
import { createMockTopicResultsSource } from './source/mock'
import type { TopicResultsSource } from './source'

/** The mock topic on the project's own domain, so the drawer checks a value before saving. */
function sourceWithDomain(): TopicResultsSource {
  const source = createMockTopicResultsSource()
  return {
    ...source,
    results: async (request) => {
      const results = await source.results(request)
      return { ...results, topic: { ...results.topic, domain: 'textbolt.com' } }
    }
  }
}

function renderScreen(): ReturnType<typeof render> {
  return render(
    <DrillHost>
      <TopicResultsScreen
        projectId={TEXTBOLT_TOPIC_PROJECT_ID}
        projectName="TextBolt"
        topicId={TEXTBOLT_TOPIC_ID}
        viewStore={null}
        source={sourceWithDomain()}
      />
    </DrillHost>
  )
}

beforeEach(() => {
  window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}`
})

afterEach(cleanup)

describe('a topic target page', () => {
  test('is set from a typed path, shown with Copy and Open, and cleared', async () => {
    const view = renderScreen()
    const line = await view.findByTestId('topic-target-page')
    // No main target page: only the way to set one, so it never reads as missing.
    expect(line.textContent).toBe('Set target page')
    fireEvent.click(within(line).getByRole('button', { name: 'Set target page' }))

    const drawer = await view.findByRole('dialog', { name: 'Target page' })
    expect(window.location.hash).toContain('drawer=topic-page')
    const field = within(drawer).getByLabelText('Target page') as HTMLInputElement
    const save = (): HTMLButtonElement =>
      within(drawer).getByRole('button', { name: /target page$/ }) as HTMLButtonElement
    // No target yet: the page answers cite most is preselected, and says why; Save keeps it.
    const note = await within(drawer).findByTestId('target-pick-note')
    expect(note.textContent).toBe(
      'Picked because Google and ChatGPT already cite it for 17 of 146 questions and keywords. Save to keep it.'
    )
    expect(field.value).toBe('https://textbolt.com/blog/how-to-set-up-text-alerts-for-business')
    expect(save().disabled).toBe(false)

    fireEvent.change(field, { target: { value: 'https://simpletexting.com/pricing' } })
    expect(within(drawer).getByRole('alert').textContent).toBe(
      'Use a page on textbolt.com, or a path such as /pricing.'
    )
    expect(save().disabled).toBe(true)

    fireEvent.change(field, { target: { value: '/pricing/' } })
    expect(within(drawer).queryByRole('alert')).toBeNull()
    expect(within(drawer).getByText(/Saves as/)).toBeTruthy()
    fireEvent.click(save())
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())

    await waitFor(() => expect(line.textContent).toContain('Target page'))
    expect(within(line).getByText('/pricing')).toBeTruthy()
    expect(within(line).getByRole('button', { name: 'Copy /pricing' })).toBeTruthy()
    expect(within(line).getByLabelText('Open /pricing in a new tab')).toBeTruthy()
    expect(await axeViolations(line)).toEqual([])

    fireEvent.click(within(line).getByRole('button', { name: 'Change target page' }))
    const again = await view.findByRole('dialog', { name: 'Target page' })
    expect((within(again).getByLabelText('Target page') as HTMLInputElement).value).toBe(
      'https://textbolt.com/pricing'
    )
    fireEvent.click(within(again).getByRole('radio', { name: 'No target page' }))
    fireEvent.click(within(again).getByRole('button', { name: 'Clear target page' }))
    await waitFor(() => expect(line.textContent).toBe('Set target page'))
  })

  test('picks one of the project pages, and has no axe violations', async () => {
    window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}?drawer=topic-page`
    const view = renderScreen()
    const drawer = await view.findByRole('dialog', { name: 'Target page' })
    const pages = await within(drawer).findByRole('group', { name: 'Pick a page' })
    const first = within(pages).getAllByRole('radio')[0] as HTMLInputElement
    fireEvent.click(first)
    const field = within(drawer).getByLabelText('Target page') as HTMLInputElement
    expect(field.value).toBe(first.value)
    expect(first.checked).toBe(true)
    expect(
      (within(drawer).getByRole('button', { name: 'Save target page' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
    expect(await axeViolations(drawer)).toEqual([])
  })
})
