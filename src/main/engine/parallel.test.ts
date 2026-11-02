import { describe, expect, test } from 'vitest'
import { createLimiter } from './checks/check-pace'
import { aiLimiter, aiTasksAtOnce, mapEach, settleEach } from './parallel'

/** A promise the test settles by hand, so calls overlap exactly as the test says. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

describe('aiTasksAtOnce', () => {
  test('follows Settings "Calls at once", at least one', () => {
    expect(aiTasksAtOnce(2)).toBe(2)
    expect(aiTasksAtOnce(5)).toBe(5)
    expect(aiTasksAtOnce(0)).toBe(1)
    expect(aiTasksAtOnce(-3)).toBe(1)
    expect(aiTasksAtOnce(2.7)).toBe(2)
    expect(aiTasksAtOnce(Number.NaN)).toBe(1)
  })
})

describe('settleEach', () => {
  test('keeps at most the limiter size in flight, started in item order', async () => {
    const holds = Array.from({ length: 5 }, () => deferred())
    const started: number[] = []
    let inFlight = 0
    let most = 0
    const done = settleEach([0, 1, 2, 3, 4], aiLimiter(2), async (item) => {
      started.push(item)
      inFlight += 1
      most = Math.max(most, inFlight)
      await holds[item]?.promise
      inFlight -= 1
      return item * 10
    })
    await settle()
    expect(started).toEqual([0, 1])
    holds[1]?.resolve()
    await settle()
    expect(started).toEqual([0, 1, 2])
    for (const hold of holds) hold.resolve()
    const results = await done
    expect(most).toBe(2)
    expect(results).toEqual([0, 10, 20, 30, 40].map((value) => ({ ok: true, value })))
  })

  test('results come back in item order even when later items finish first', async () => {
    const holds = Array.from({ length: 3 }, () => deferred())
    const done = settleEach(['a', 'b', 'c'], createLimiter(3), async (item, index) => {
      await holds[index]?.promise
      return item.toUpperCase()
    })
    holds[2]?.resolve()
    await settle()
    holds[1]?.resolve()
    await settle()
    holds[0]?.resolve()
    const results = await done
    expect(results.map((result) => (result.ok ? result.value : null))).toEqual(['A', 'B', 'C'])
  })

  test('one failure is kept in its place; the others still run and succeed', async () => {
    const ran: number[] = []
    const results = await settleEach([0, 1, 2, 3], createLimiter(2), async (item) => {
      ran.push(item)
      if (item === 1) throw new Error('item 1 failed')
      return item
    })
    expect(ran).toEqual([0, 1, 2, 3])
    expect(results[0]).toEqual({ ok: true, value: 0 })
    expect(results[1]?.ok).toBe(false)
    expect(results[1]?.ok === false ? (results[1].error as Error).message : '').toBe(
      'item 1 failed'
    )
    expect(results[3]).toEqual({ ok: true, value: 3 })
  })

  test('a limiter shared by two steps keeps their total in flight to its size', async () => {
    const shared = createLimiter(2)
    const holds = Array.from({ length: 6 }, () => deferred())
    let inFlight = 0
    let most = 0
    const work = async (index: number): Promise<void> => {
      inFlight += 1
      most = Math.max(most, inFlight)
      await holds[index]?.promise
      inFlight -= 1
    }
    const first = settleEach([0, 1, 2], shared, work)
    const second = settleEach([3, 4, 5], shared, work)
    await settle()
    expect(inFlight).toBe(2)
    for (const hold of holds) {
      hold.resolve()
      await settle()
    }
    await Promise.all([first, second])
    expect(most).toBe(2)
  })

  test('an item that sees a stop flag set by an earlier item skips its call', async () => {
    let stopped = false
    const called: number[] = []
    await settleEach([0, 1, 2, 3], createLimiter(1), async (item) => {
      if (stopped) return
      called.push(item)
      if (item === 1) stopped = true
    })
    expect(called).toEqual([0, 1])
  })
})

describe('mapEach', () => {
  test('returns values in item order', async () => {
    const values = await mapEach([3, 1, 2], createLimiter(3), async (item) => item * 2)
    expect(values).toEqual([6, 2, 4])
  })

  test('throws the first failure in item order, after every item has run', async () => {
    const holds = Array.from({ length: 3 }, () => deferred())
    const finished: number[] = []
    const done = mapEach([0, 1, 2], createLimiter(3), async (item) => {
      await holds[item]?.promise
      finished.push(item)
      if (item > 0) throw new Error(`item ${item} failed`)
      return item
    })
    let error: unknown = null
    const caught = done.catch((reason: unknown) => {
      error = reason
    })
    holds[2]?.resolve()
    await settle()
    holds[1]?.resolve()
    await settle()
    expect(error).toBeNull()
    holds[0]?.resolve()
    await caught
    expect(finished).toEqual([2, 1, 0])
    expect((error as Error | null)?.message).toBe('item 1 failed')
  })
})
