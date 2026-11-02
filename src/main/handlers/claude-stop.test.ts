import { describe, expect, test } from 'vitest'
import { IpcRequestError } from '../ipc-request'
import { ClaudeLimitError, ProviderError } from '../providers/errors'
import { guard, type EngineContext } from './context'

const ctx = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  },
  knownSecrets: () => ['sk-ant-api03-SECRET00000000000000']
} as unknown as EngineContext

describe('a Claude stop reaches the window in its own words', () => {
  test('a limit keeps its message and next step instead of "Request failed"', async () => {
    const said =
      "You've reached your weekly Claude usage limit. It resets Monday, Nov 2 at 9:00 AM. Work already done is kept."
    const error = await guard('assist:run', ctx, () => {
      throw new ClaudeLimitError(said, [], { kind: 'weekly', resetsAt: new Date() }, 'Wait.')
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(IpcRequestError)
    expect((error as IpcRequestError).message).toBe(`assist:run: ${said}`)
    expect((error as IpcRequestError).nextStep).toBe('Wait.')
  })

  test.each(['logged_out', 'plan_inactive', 'credit_low', 'unauthorized', 'overloaded'] as const)(
    '%s keeps its message',
    async (code) => {
      const error = await guard('helpfill:run', ctx, () => {
        throw new ProviderError('Plain words.', { code, state: 'warning', nextStep: null })
      }).catch((caught: unknown) => caught)
      expect((error as Error).message).toBe('helpfill:run: Plain words.')
    }
  )

  test('other provider failures stay generic', async () => {
    const error = await guard('helpfill:run', ctx, () => {
      throw new ProviderError('socket hang up at 10.0.0.1', {
        code: 'network',
        state: 'warning',
        nextStep: null
      })
    }).catch((caught: unknown) => caught)
    expect((error as Error).message).toBe('helpfill:run: Request failed')
  })
})
