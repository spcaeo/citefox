import { afterEach, describe, expect, test } from 'vitest'
import type { PageReadResult } from '@shared/ipc'
import { resetAutoReads, takeAutoRead } from './autoRead'

const STORED = { id: 'snap-1' } as PageReadResult

afterEach(() => {
  resetAutoReads()
})

describe('takeAutoRead', () => {
  test('does not start when a read is already stored', async () => {
    let calls = 0
    const claim = takeAutoRead('textbolt\u0000alerts', STORED, () => {
      calls += 1
      return Promise.resolve(STORED)
    })
    await Promise.resolve()
    expect(claim).toBeNull()
    expect(calls).toBe(0)
  })

  test('starts once and a second caller joins the same read', async () => {
    let calls = 0
    let finish: (result: PageReadResult) => void = () => undefined
    const start = (): Promise<PageReadResult> => {
      calls += 1
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const first = takeAutoRead('textbolt\u0000new', null, start)
    const second = takeAutoRead('textbolt\u0000new', null, start)
    expect(first?.owner).toBe(true)
    expect(second?.owner).toBe(false)
    expect(second?.promise).toBe(first?.promise)
    expect(calls).toBe(0)
    await Promise.resolve()
    expect(calls).toBe(1)
    finish(STORED)
    await expect(first?.promise).resolves.toBe(STORED)
    await expect(second?.promise).resolves.toBe(STORED)
    expect(calls).toBe(1)
  })

  test('a settled failure can start again, and a different page is independent', async () => {
    let calls = 0
    const start = (): Promise<PageReadResult> => {
      calls += 1
      return Promise.reject(new Error('nope'))
    }
    const failed = takeAutoRead('textbolt\u0000new', null, start)
    await expect(failed?.promise).rejects.toThrow('nope')
    const other = takeAutoRead('textbolt\u0000other', null, start)
    const again = takeAutoRead('textbolt\u0000new', null, start)
    expect(other?.owner).toBe(true)
    expect(again?.owner).toBe(true)
    expect(again?.promise).not.toBe(other?.promise)
    await expect(other?.promise).rejects.toThrow('nope')
    await expect(again?.promise).rejects.toThrow('nope')
    expect(calls).toBe(3)
  })
})
