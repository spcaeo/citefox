// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddQuestionsSource } from '../source'
import type { DraftRow } from '../types'
import {
  DRAFT_RETRY_DELAY_MS,
  DRAFT_SAVE_DELAY_MS,
  useQuestionsDraft,
  type DraftSnapshot
} from './useQuestionsDraft'

function row(question: string): DraftRow {
  return {
    key: 'k1',
    question,
    stage: 'doubts',
    page: '',
    market: '',
    tags: '',
    topic: '',
    createTopic: false,
    addMarket: false,
    keep: false,
    origin: 'typed'
  } as unknown as DraftRow
}

function snapshot(question: string): DraftSnapshot {
  return { targetId: 'topic-1', defaultPage: null, rows: [row(question)] }
}

describe('useQuestionsDraft: a failed save is not counted as saved', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries the same draft after a failure and clears the error once it is saved', async () => {
    const saveDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk is full'))
      .mockResolvedValue({ saved: true })
    const source = {
      'import:getDraft': async () => null,
      'import:saveDraft': saveDraft,
      'import:clearDraft': async () => ({ cleared: true })
    } as unknown as AddQuestionsSource

    const { result } = renderHook(() => useQuestionsDraft(source, 'proj-1', snapshot('is it free')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
    })
    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(result.current.saveFailed).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_RETRY_DELAY_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS)
    })
    expect(saveDraft).toHaveBeenCalledTimes(2)
    expect(saveDraft.mock.calls[1]?.[0]).toEqual(saveDraft.mock.calls[0]?.[0])
    expect(result.current.saveFailed).toBe(false)

    // Saved: the same rows are not sent again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_RETRY_DELAY_MS * 3)
    })
    expect(saveDraft).toHaveBeenCalledTimes(2)
  })
})
