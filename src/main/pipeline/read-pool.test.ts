import { afterEach, describe, expect, test } from 'vitest'
import {
  createReadPool,
  PAGE_READS_AT_ONCE,
  PAGE_READS_PER_SITE,
  resetSharedReadPoolForTests,
  sharedReadPool,
  siteKey
} from './read-pool'

/** A promise the test settles by hand, so reads overlap exactly as the test says. */
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

afterEach(() => {
  resetSharedReadPoolForTests()
})

describe('siteKey', () => {
  test('one key per site: www and case do not matter, the path does not count', () => {
    expect(siteKey('https://www.TextBolt.com/pricing')).toBe('textbolt.com')
    expect(siteKey('https://textbolt.com/')).toBe('textbolt.com')
    expect(siteKey('https://blog.textbolt.com/a')).toBe('blog.textbolt.com')
    expect(siteKey('not a url')).toBe('not a url')
  })
})

describe('createReadPool', () => {
  test('the app default is four reads at once, two per site', () => {
    expect(PAGE_READS_AT_ONCE).toBe(4)
    expect(PAGE_READS_PER_SITE).toBe(2)
    expect(sharedReadPool()).toBe(sharedReadPool())
  })

  test('never more than two reads on one site, the rest wait in order', async () => {
    const pool = createReadPool(4, 2)
    const holds = Array.from({ length: 5 }, () => deferred())
    const started: number[] = []
    const reads = holds.map((hold, index) =>
      pool.run(`https://textbolt.com/page-${index}`, async () => {
        started.push(index)
        await hold.promise
        return index
      })
    )
    await settle()
    expect(started).toEqual([0, 1])
    expect(pool.active()).toBe(2)
    holds[0]?.resolve()
    await settle()
    expect(started).toEqual([0, 1, 2])
    for (const hold of holds) hold.resolve()
    expect(await Promise.all(reads)).toEqual([0, 1, 2, 3, 4])
    expect(pool.active()).toBe(0)
  })

  test('never more than four at once overall; a full site does not block another site', async () => {
    const pool = createReadPool(4, 2)
    const holds = new Map<string, ReturnType<typeof deferred>>()
    const started: string[] = []
    let most = 0
    const urls = [
      'https://a.com/1',
      'https://a.com/2',
      'https://a.com/3',
      'https://b.com/1',
      'https://b.com/2',
      'https://c.com/1',
      'https://c.com/2'
    ]
    const reads = urls.map((url) => {
      const hold = deferred()
      holds.set(url, hold)
      return pool.run(url, async () => {
        started.push(url)
        most = Math.max(most, pool.active())
        await hold.promise
      })
    })
    await settle()
    // a.com/3 waits for its site; b.com takes the free turns.
    expect(started).toEqual([
      'https://a.com/1',
      'https://a.com/2',
      'https://b.com/1',
      'https://b.com/2'
    ])
    holds.get('https://b.com/1')?.resolve()
    await settle()
    // The oldest waiter whose site has room goes next: c.com/1, not a.com/3.
    expect(started.at(-1)).toBe('https://c.com/1')
    holds.get('https://a.com/1')?.resolve()
    await settle()
    expect(started.at(-1)).toBe('https://a.com/3')
    for (const hold of holds.values()) hold.resolve()
    await Promise.all(reads)
    expect(most).toBe(4)
    expect(started).toHaveLength(7)
  })

  test('a failed read frees its turn and fails only itself', async () => {
    const pool = createReadPool(1, 1)
    const first = deferred()
    const failing = pool.run('https://a.com/1', async () => {
      await first.promise
    })
    const next = pool.run('https://a.com/2', async () => 'read')
    first.reject(new Error('timed out'))
    await expect(failing).rejects.toThrow('timed out')
    await expect(next).resolves.toBe('read')
    expect(pool.active()).toBe(0)
  })

  test('a new read does not jump ahead of an older read waiting on the same site', async () => {
    const pool = createReadPool(4, 1)
    const hold = deferred()
    const order: string[] = []
    const first = pool.run('https://a.com/1', async () => {
      order.push('1')
      await hold.promise
    })
    const second = pool.run('https://a.com/2', async () => {
      order.push('2')
    })
    await settle()
    hold.resolve()
    const third = pool.run('https://a.com/3', async () => {
      order.push('3')
    })
    await Promise.all([first, second, third])
    expect(order).toEqual(['1', '2', '3'])
  })
})
