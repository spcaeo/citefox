import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs once, after the last call', () => {
    const action = vi.fn()
    const slow = debounce(action, 400)
    slow.schedule()
    vi.advanceTimersByTime(300)
    slow.schedule()
    vi.advanceTimersByTime(300)
    expect(action).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('flush runs a waiting action now and only once', () => {
    const action = vi.fn()
    const slow = debounce(action, 400)
    slow.schedule()
    slow.flush()
    slow.flush()
    vi.advanceTimersByTime(1000)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when nothing is waiting, cancel drops the action', () => {
    const action = vi.fn()
    const slow = debounce(action, 400)
    slow.flush()
    slow.schedule()
    slow.cancel()
    vi.advanceTimersByTime(1000)
    expect(action).not.toHaveBeenCalled()
  })
})
