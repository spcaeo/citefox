import { describe, expect, test } from 'vitest'
import { createLimiter, runPool } from './check-pace'

/** A promise the test settles by hand, so calls overlap exactly as the test says. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve: () => void = () => undefined
  let reject: (e: Error) => void = () => undefined
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

describe('runPool', () => {
  test('runs at most `limit` items at once, started in order', async () => {
    const holds = Array.from({ length: 7 }, () => deferred())
    const started: number[] = []
    let inFlight = 0
    let most = 0
    const done = runPool(
      [0, 1, 2, 3, 4, 5, 6],
      3,
      () => false,
      async (item) => {
        started.push(item)
        inFlight += 1
        most = Math.max(most, inFlight)
        await holds[item]?.promise
        inFlight -= 1
      }
    )
    await settle()
    expect(started).toEqual([0, 1, 2])
    holds[1]?.resolve()
    await settle()
    expect(started).toEqual([0, 1, 2, 3])
    for (const hold of holds) hold.resolve()
    await done
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(most).toBe(3)
  })

  test('a stop starts no new item, and waits for the ones running', async () => {
    const holds = Array.from({ length: 6 }, () => deferred())
    const finished: number[] = []
    let stop = false
    let resolved = false
    const done = runPool(
      [0, 1, 2, 3, 4, 5],
      3,
      () => stop,
      async (item) => {
        await holds[item]?.promise
        finished.push(item)
      }
    ).then(() => {
      resolved = true
    })
    await settle()
    stop = true
    holds[0]?.resolve()
    await settle()
    expect(resolved).toBe(false)
    holds[1]?.resolve()
    holds[2]?.resolve()
    await done
    expect(finished).toEqual([0, 1, 2])
  })

  test('a throw is passed on only after the other items are done', async () => {
    const holds = Array.from({ length: 3 }, () => deferred())
    const finished: number[] = []
    let outcome: string | null = null
    const done = runPool(
      [0, 1, 2],
      3,
      () => false,
      async (item) => {
        await holds[item]?.promise
        finished.push(item)
      }
    ).then(
      () => {
        outcome = 'ok'
      },
      (error: Error) => {
        outcome = error.message
      }
    )
    holds[0]?.reject(new Error('disk full'))
    await settle()
    expect(outcome).toBeNull()
    holds[1]?.resolve()
    holds[2]?.resolve()
    await done
    expect(outcome).toBe('disk full')
    expect(finished).toEqual([1, 2])
  })
})

describe('createLimiter', () => {
  test('never runs more than its limit, the rest wait in order', async () => {
    const limiter = createLimiter(2)
    const holds = Array.from({ length: 4 }, () => deferred())
    const started: number[] = []
    const calls = holds.map((hold, index) =>
      limiter.run(async () => {
        started.push(index)
        await hold.promise
      })
    )
    await settle()
    expect(started).toEqual([0, 1])
    expect(limiter.active()).toBe(2)
    holds[0]?.resolve()
    await settle()
    expect(started).toEqual([0, 1, 2])
    for (const hold of holds) hold.resolve()
    await Promise.all(calls)
    expect(limiter.active()).toBe(0)
  })

  test('first alone: the first call runs on its own, then the limit opens', async () => {
    const limiter = createLimiter(3, true)
    const holds = Array.from({ length: 5 }, () => deferred())
    const started: number[] = []
    const calls = holds.map((hold, index) =>
      limiter.run(async () => {
        started.push(index)
        await hold.promise
      })
    )
    await settle()
    expect(started).toEqual([0])
    holds[0]?.resolve()
    await settle()
    expect(started).toEqual([0, 1, 2, 3])
    for (const hold of holds) hold.resolve()
    await Promise.all(calls)
    expect(started).toEqual([0, 1, 2, 3, 4])
  })

  test('first alone opens after a failed first call too', async () => {
    const limiter = createLimiter(2, true)
    const first = limiter.run(async () => {
      throw new Error('bad key')
    })
    await expect(first).rejects.toThrow('bad key')
    const started: number[] = []
    const holds = [deferred(), deferred()]
    const calls = holds.map((hold, index) =>
      limiter.run(async () => {
        started.push(index)
        await hold.promise
      })
    )
    await settle()
    expect(started).toEqual([0, 1])
    for (const hold of holds) hold.resolve()
    await Promise.all(calls)
  })
})
