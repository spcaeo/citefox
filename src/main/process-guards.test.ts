import { describe, expect, it, vi } from 'vitest'
import { installProcessGuards, type GuardedProcess } from './process-guards'

function fakeProcess(): {
  target: GuardedProcess
  emit: (event: string, value: unknown) => void
} {
  const listeners = new Map<string, (value: never) => void>()
  const target = {
    on(event: string, listener: (value: never) => void) {
      listeners.set(event, listener)
      return target
    }
  } as GuardedProcess
  return { target, emit: (event, value) => listeners.get(event)?.(value as never) }
}

describe('process guards', () => {
  it('log an uncaught rejection and keep running', () => {
    const { target, emit } = fakeProcess()
    const logger = { error: vi.fn() }
    const onFatal = vi.fn()
    installProcessGuards(target, logger, onFatal)
    const reason = new Error('boom')
    emit('unhandledRejection', reason)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('nothing caught'), reason)
    expect(onFatal).not.toHaveBeenCalled()
  })

  it('log an uncaught error, and a background run is told to end', () => {
    const { target, emit } = fakeProcess()
    const logger = { error: vi.fn() }
    const onFatal = vi.fn()
    installProcessGuards(target, logger, onFatal)
    emit('uncaughtException', new Error('bad'))
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(onFatal).toHaveBeenCalledTimes(1)
  })

  it('work without an end callback', () => {
    const { target, emit } = fakeProcess()
    const logger = { error: vi.fn() }
    installProcessGuards(target, logger)
    expect(() => emit('uncaughtException', new Error('bad'))).not.toThrow()
  })
})
