// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TopicSummary } from '@shared/domain'
import { topicSummary } from '../../questions/questions.fixtures.test-helper'
import { UndoToastHost } from '../../ui'
import { axeViolations } from '../../ui/axe.test-helper'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { TopicSettingsDrawer, type TopicSettingsSource } from './TopicSettingsDrawer'

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
})

function fakeSource(
  topics: TopicSummary[] = [
    topicSummary({ id: 'topic-a', name: 'Gateway shutdowns', intervalDays: 14, questions: 6 })
  ]
): TopicSettingsSource & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    'topics:list': vi.fn(async () => ({ topics })),
    'topics:update': vi.fn(async (request) => {
      calls.push(['update', request])
      return topics[0] as TopicSummary
    }),
    'topics:duplicate': vi.fn(async (request) => {
      calls.push(['duplicate', request])
      return {
        topicId: 'topic-a-copy',
        name: 'Gateway shutdowns (copy)',
        questions: 6,
        message: ''
      }
    }),
    'topics:merge': vi.fn(async () => {
      throw new Error('not used')
    })
  }
}

function shown(
  source = fakeSource(),
  topicId = 'topic-a'
): {
  view: ReturnType<typeof render>
  onClose: ReturnType<typeof vi.fn>
  onDeleted: ReturnType<typeof vi.fn>
  onDuplicated: ReturnType<typeof vi.fn>
  source: ReturnType<typeof fakeSource>
} {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  const onDuplicated = vi.fn()
  const view = render(
    <>
      <TopicSettingsDrawer
        projectId="proj-1"
        topicId={topicId}
        source={source}
        onClose={onClose}
        onDeleted={onDeleted}
        onDuplicated={onDuplicated}
      />
      <UndoToastHost />
    </>
  )
  return { view, onClose, onDeleted, onDuplicated, source }
}

describe('TopicSettingsDrawer', () => {
  it('shows the topic, and Save stays off until something changes', async () => {
    const { view } = shown()
    const name = (await view.findByRole('textbox', { name: 'Topic name' })) as HTMLInputElement
    expect(name.value).toBe('Gateway shutdowns')
    const facts = view.container.querySelector('dl[aria-label="About this topic"]')
    expect(facts?.textContent).toContain('6')
    expect(facts?.textContent).toContain('Buyer problem')
    expect(facts?.textContent).toContain('Not yet')
    const save = view.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('saves only what changed, then offers Undo with the old values', async () => {
    const { view, source, onClose } = shown()
    const name = await view.findByRole('textbox', { name: 'Topic name' })
    fireEvent.change(name, { target: { value: 'Gateways' } })
    fireEvent.click(view.getByRole('button', { name: 'Paused' }))
    const interval = view.getByRole('combobox', { name: 'Check every' }) as HTMLSelectElement
    expect(interval.disabled).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(source.calls[0]).toEqual([
      'update',
      { projectId: 'proj-1', topicId: 'topic-a', name: 'Gateways', status: 'paused' }
    ])
    expect((await view.findByTestId('topic-undo')).textContent).toContain('Saved Gateways.')
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(source.calls).toHaveLength(2))
    expect(source.calls[1]).toEqual([
      'update',
      { projectId: 'proj-1', topicId: 'topic-a', name: 'Gateway shutdowns', status: 'tracked' }
    ])
  })

  it('a blank name cannot be saved', async () => {
    const { view } = shown()
    fireEvent.change(await view.findByRole('textbox', { name: 'Topic name' }), {
      target: { value: '  ' }
    })
    expect(view.getByText('Give the topic a name.')).toBeTruthy()
    expect((view.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('deletes at once with Undo, and duplicates into a new topic', async () => {
    const first = shown()
    fireEvent.click(await first.view.findByRole('button', { name: 'Delete topic' }))
    await waitFor(() => expect(first.onDeleted).toHaveBeenCalled())
    expect(first.source.calls).toEqual([
      ['update', { projectId: 'proj-1', topicId: 'topic-a', status: 'removed' }]
    ])
    cleanup()

    const second = shown()
    fireEvent.click(await second.view.findByRole('button', { name: 'Duplicate topic' }))
    await waitFor(() => expect(second.onDuplicated).toHaveBeenCalledWith('topic-a-copy'))
  })

  it('says a deleted or unknown topic is not available', async () => {
    const { view } = shown(fakeSource([]), 'topic-x')
    const drawer = await view.findByRole('dialog', { name: /Topic settings/ })
    expect(
      await within(drawer).findByText(
        'That topic is not available to you. It may have been deleted.'
      )
    ).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'Save changes' })).toBeNull()
  })
})
