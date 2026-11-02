import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetUndoToastForTests, runUndo } from '../../ui/undoStore'
import { duplicateTopics, mergeTopics, removeTopics, setTopicsPaused } from './actions'
import type { TopicMergeSource } from './actions'

/** After a reset, the first toast an action shows has id 1. */
const FIRST_TOAST = 1

function fakeSource(): TopicMergeSource & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    'topics:update': vi.fn(async (request) => {
      calls.push(['update', request])
      return {} as never
    }),
    'topics:duplicate': vi.fn(async (request) => {
      calls.push(['duplicate', request])
      return {
        topicId: `${request.topicId}-copy`,
        name: request.name ?? `${request.topicId} (copy)`,
        questions: 2,
        message: 'Made.'
      }
    }),
    'topics:merge': vi.fn(async (request) => {
      calls.push(['merge', request])
      return {
        moved: 3,
        topicId: request.intoTopicId,
        promptIds: [{ from: `${request.topicId}-q1`, to: `${request.intoTopicId}-q9` }],
        skipped: [],
        message: 'Merged.'
      }
    }),
    'topics:moveQuestions': vi.fn(async (request) => {
      calls.push(['move', request])
      return {
        moved: request.items.length,
        topicId: null,
        promptIds: [],
        skipped: [],
        message: 'Moved.'
      }
    })
  }
}

const A = { id: 'a', name: 'Alpha' }
const B = { id: 'b', name: 'Beta' }

afterEach(() => resetUndoToastForTests())

describe('topic actions', () => {
  it('pauses, and Undo resumes', async () => {
    const source = fakeSource()
    expect(await setTopicsPaused(source, 'p', [A], true)).toBe('Paused checks for Alpha.')
    await runUndo(FIRST_TOAST)
    expect(source.calls).toEqual([
      ['update', { projectId: 'p', topicId: 'a', status: 'paused' }],
      ['update', { projectId: 'p', topicId: 'a', status: 'tracked' }]
    ])
  })

  it('resumes several topics with one message; nothing ticked changes nothing', async () => {
    const source = fakeSource()
    expect(await setTopicsPaused(source, 'p', [A, B], false)).toBe('Resumed checks for 2 topics.')
    expect(source.calls).toHaveLength(2)
    expect(await setTopicsPaused(source, 'p', [], true)).toBe('Nothing changed.')
    expect(source.calls).toHaveLength(2)
  })

  it('removes, and Undo brings a paused topic back paused', async () => {
    const source = fakeSource()
    expect(await removeTopics(source, 'p', [{ ...A, status: 'paused' }, B])).toBe(
      'Deleted 2 topics.'
    )
    await runUndo(FIRST_TOAST)
    expect(source.calls).toEqual([
      ['update', { projectId: 'p', topicId: 'a', status: 'removed' }],
      ['update', { projectId: 'p', topicId: 'b', status: 'removed' }],
      ['update', { projectId: 'p', topicId: 'a', status: 'paused' }],
      ['update', { projectId: 'p', topicId: 'b', status: 'tracked' }]
    ])
  })

  it('duplicates, returns the copies, and Undo removes them', async () => {
    const source = fakeSource()
    const made = await duplicateTopics(source, 'p', [A], 'Alpha again')
    expect(made).toEqual({ message: 'Made Alpha again.', topicIds: ['a-copy'] })
    await runUndo(FIRST_TOAST)
    expect(source.calls).toEqual([
      ['duplicate', { projectId: 'p', topicId: 'a', name: 'Alpha again' }],
      ['update', { projectId: 'p', topicId: 'a-copy', status: 'removed' }]
    ])
  })

  it('merges every other topic into the destination; Undo brings it back with its questions', async () => {
    const source = fakeSource()
    const C = { id: 'c', name: 'Gamma', status: 'paused' as const }
    expect(await mergeTopics(source, 'p', [A, C, B], B)).toBe(
      'Merged 2 topics into Beta (6 questions moved).'
    )
    await runUndo(FIRST_TOAST)
    expect(source.calls).toEqual([
      ['merge', { projectId: 'p', topicId: 'a', intoTopicId: 'b' }],
      ['merge', { projectId: 'p', topicId: 'c', intoTopicId: 'b' }],
      // Last merge first; a paused topic comes back paused.
      ['update', { projectId: 'p', topicId: 'c', status: 'paused' }],
      [
        'move',
        {
          projectId: 'p',
          items: [{ sourceId: 'b', promptId: 'b-q9' }],
          to: { kind: 'topic', topicId: 'c' }
        }
      ],
      ['update', { projectId: 'p', topicId: 'a', status: 'tracked' }],
      [
        'move',
        {
          projectId: 'p',
          items: [{ sourceId: 'b', promptId: 'b-q9' }],
          to: { kind: 'topic', topicId: 'a' }
        }
      ]
    ])
  })
})
