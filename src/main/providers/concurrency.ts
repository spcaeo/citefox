import { ProviderError } from './errors'

/**
 * LLM-7. At most `limit` calls run at once. The default in Settings is 2.
 * The queue resumes the oldest waiter when a slot frees.
 */
export function createConcurrencyGate(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ProviderError('Claude concurrency must be a positive integer', {
      code: 'validation',
      state: 'warning',
      nextStep: 'Set Calls at once to a whole number of at least 1.'
    })
  }
  let active = 0
  const waiters: (() => void)[] = []
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    }
    active += 1
    try {
      return await fn()
    } finally {
      active -= 1
      const next = waiters.shift()
      if (next !== undefined) next()
    }
  }
}
