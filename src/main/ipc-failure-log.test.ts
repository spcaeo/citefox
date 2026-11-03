import { describe, expect, test } from 'vitest'
import { logIpcFailure } from './ipc'

function recorder(): { lines: Array<[string, unknown]>; warn: (m: string, e?: unknown) => void } {
  const lines: Array<[string, unknown]> = []
  return { lines, warn: (message, extra) => void lines.push([message, extra]) }
}

describe('logIpcFailure', () => {
  test('a throw is logged with the channel and error name, then thrown again', async () => {
    const log = recorder()
    await expect(
      logIpcFailure(log, 'checks:run', () => {
        throw new TypeError('secret text here')
      })
    ).rejects.toThrow('secret text here')
    expect(log.lines).toEqual([['action failed', { channel: 'checks:run', threw: 'TypeError' }]])
    expect(JSON.stringify(log.lines)).not.toContain('secret text')
  })

  test('ok: false is logged with a short code only, never the message', async () => {
    const log = recorder()
    const result = { ok: false, code: 'rate_limited', message: 'Your question about X failed' }
    await expect(logIpcFailure(log, 'checks:run', () => result)).resolves.toBe(result)
    expect(log.lines).toEqual([
      ['action did not finish', { channel: 'checks:run', reason: 'rate_limited' }]
    ])
    expect(JSON.stringify(log.lines)).not.toContain('question about')
  })

  test('a good answer, a plain value and a missing logger write nothing and change nothing', async () => {
    const log = recorder()
    await logIpcFailure(log, 'a', () => ({ ok: true }))
    await logIpcFailure(log, 'b', () => 5)
    await logIpcFailure(log, 'c', () => null)
    expect(log.lines).toEqual([])
    await expect(logIpcFailure(undefined, 'd', () => ({ ok: false }))).resolves.toEqual({
      ok: false
    })
  })
})
