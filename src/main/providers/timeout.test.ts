import { afterEach, describe, expect, test, vi } from 'vitest'
import { ProviderTimeoutError } from './errors'
import { retryDelayMs } from './retry'
import { withTimeout } from './timeout'

afterEach(() => {
  vi.useRealTimers()
})

describe('withTimeout', () => {
  test('aborts the signal and rejects when the timer fires', async () => {
    vi.useFakeTimers()
    let aborted = false
    const pending = withTimeout(
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
          })
          setTimeout(() => resolve('late'), 10_000)
        }),
      50,
      'probe'
    )
    const assertion = expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError)
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    expect(aborted).toBe(true)
  })

  test('returns the operation result when it finishes first', async () => {
    await expect(withTimeout(async () => 'ok', 1_000, 'probe')).resolves.toBe('ok')
  })
})

describe('retry delays', () => {
  test('waits 200 ms then 400 ms', () => {
    expect(retryDelayMs(1)).toBe(200)
    expect(retryDelayMs(2)).toBe(400)
    expect(retryDelayMs(3)).toBe(800)
  })
})
