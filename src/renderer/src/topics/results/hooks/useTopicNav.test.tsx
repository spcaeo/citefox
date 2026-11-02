// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TopicSummary } from '@shared/domain'
import { topicSummary } from '../../../questions/questions.fixtures.test-helper'
import { notifyTopicsChanged } from '../../clusters/events'
import { createMockTopicResultsSource } from '../source/mock'
import { useTopicNav } from './useTopicNav'

afterEach(cleanup)

describe('useTopicNav', () => {
  it('leaves deleted topics out, and reloads when the topics change', async () => {
    const topics: TopicSummary[] = [
      topicSummary({ id: 'a', name: 'Alpha' }),
      topicSummary({ id: 'b', name: 'Beta', status: 'removed' }),
      topicSummary({ id: 'c', name: 'Gamma', status: 'paused' })
    ]
    const source = createMockTopicResultsSource()
    vi.spyOn(source, 'list').mockImplementation(async () => topics.map((topic) => ({ ...topic })))
    const { result } = renderHook(() => useTopicNav('proj-1', source))
    await waitFor(() =>
      expect(result.current.map((item) => item.title)).toEqual(['Alpha', 'Gamma'])
    )
    topics[1] = { ...(topics[1] as TopicSummary), status: 'tracked' }
    act(() => notifyTopicsChanged())
    await waitFor(() =>
      expect(result.current.map((item) => item.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
    )
  })
})
