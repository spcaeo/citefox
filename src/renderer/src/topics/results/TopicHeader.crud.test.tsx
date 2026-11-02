// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TEXTBOLT_TOPIC_ID,
  TEXTBOLT_TOPIC_PROJECT_ID,
  textboltTopicResults
} from '@shared/fixtures/textbolt-topic'
import { DrillHost } from '../../drill'
import { UndoToastHost } from '../../ui'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { TopicResultsScreen } from '.'
import { createMockTopicResultsSource } from './source/mock'
import type { TopicResultsSource } from './source'

const fixture = textboltTopicResults()

function renderScreen(source: TopicResultsSource = createMockTopicResultsSource()): {
  view: ReturnType<typeof render>
  source: TopicResultsSource
} {
  const view = render(
    <DrillHost>
      <TopicResultsScreen
        projectId={TEXTBOLT_TOPIC_PROJECT_ID}
        projectName="TextBolt"
        topicId={TEXTBOLT_TOPIC_ID}
        viewStore={null}
        source={source}
      />
      <UndoToastHost />
    </DrillHost>
  )
  return { view, source }
}

function query(): URLSearchParams {
  const hash = window.location.hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

beforeEach(() => {
  window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}`
})

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
})

describe('Topic header CRUD', () => {
  test('clicking the name renames it in place; Undo puts the old name back', async () => {
    const source = createMockTopicResultsSource()
    const update = vi.spyOn(source, 'update')
    const { view } = renderScreen(source)
    fireEvent.click(await view.findByRole('button', { name: fixture.topic.name }))
    const input = view.getByRole('textbox', { name: `Rename ${fixture.topic.name}` })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(view.getByRole('alert').textContent).toBe('Give the topic a name.')
    fireEvent.change(input, { target: { value: 'Gateway shutdowns' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await view.findByText('Renamed to Gateway shutdowns.')).toBeTruthy()
    expect(update).toHaveBeenCalledWith({
      projectId: TEXTBOLT_TOPIC_PROJECT_ID,
      topicId: TEXTBOLT_TOPIC_ID,
      name: 'Gateway shutdowns'
    })
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith({
        projectId: TEXTBOLT_TOPIC_PROJECT_ID,
        topicId: TEXTBOLT_TOPIC_ID,
        name: fixture.topic.name
      })
    )
  })

  test('Escape leaves the name as it was', async () => {
    const source = createMockTopicResultsSource()
    const update = vi.spyOn(source, 'update')
    const { view } = renderScreen(source)
    fireEvent.click(await view.findByRole('button', { name: fixture.topic.name }))
    const input = view.getByRole('textbox', { name: `Rename ${fixture.topic.name}` })
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(view.queryByRole('textbox', { name: /^Rename/ })).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  test('⋯ → Topic settings… opens the drawer on the URL', async () => {
    const { view } = renderScreen()
    fireEvent.click(await view.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Topic settings…' }))
    await waitFor(() => expect(query().get('drawer')).toBe('topic-settings'))
    expect(query().get('ts.topic')).toBe(TEXTBOLT_TOPIC_ID)
  })

  test('a topic with no questions says so and offers Add questions, not Check now', async () => {
    const source = createMockTopicResultsSource()
    const empty = {
      ...fixture,
      topic: { ...fixture.topic, questions: 0, keywords: 0, status: 'paused' as const },
      rows: []
    }
    vi.spyOn(source, 'results').mockResolvedValue(empty)
    const { view } = renderScreen(source)
    expect(await view.findByRole('heading', { name: 'No questions yet' })).toBeTruthy()
    expect(view.getByText('Paused')).toBeTruthy()
    expect(view.queryByRole('link', { name: 'Check now' })).toBeNull()
    const links = view.getAllByRole('link', { name: 'Add questions' })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(
        `#/topics/${TEXTBOLT_TOPIC_ID}?drawer=add-questions&target=${TEXTBOLT_TOPIC_ID}`
      )
    }
    expect(view.queryByRole('tablist')).toBeNull()
  })
})
