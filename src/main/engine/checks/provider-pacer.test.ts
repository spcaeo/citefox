import { describe, expect, test } from 'vitest'
import {
  BACKOFF_CAP_MS,
  backoffMs,
  createCallPacer,
  MAX_RETRY_AFTER_MS,
  PACING,
  type CallPacer,
  type PacingConfig
} from './provider-pacer'

/** A clock that moves only when something sleeps, so waits are exactly as long as they say. */
function fakeTime(): {
  now: () => number
  sleep: (ms: number) => Promise<void>
  sleeps: number[]
  waited: () => number
  advance: (ms: number) => void
} {
  let clock = 1_000_000
  const sleeps: number[] = []
  return {
    now: () => clock,
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    waited: () => sleeps.reduce((sum, ms) => sum + ms, 0),
    advance: (ms) => {
      clock += ms
    }
  }
}

/** Jitter fixed at its middle: a backoff is exactly 2 s, 4 s, 8 s ... */
const NO_JITTER = (): number => 0.5

function pacerOf(time: ReturnType<typeof fakeTime>, config: Partial<PacingConfig> = {}): CallPacer {
  return createCallPacer(
    'cloro',
    { now: time.now, sleep: time.sleep, random: NO_JITTER },
    { ...PACING.cloro, ...config }
  )
}

describe('backoffMs', () => {
  test('doubles from 2 s and is capped at 60 s', () => {
    const steps = [1, 2, 3, 4, 5, 6, 7, 8].map((strike) => backoffMs(strike, NO_JITTER))
    expect(steps).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
    expect(BACKOFF_CAP_MS).toBe(60_000)
  })

  test('jitter stays within 20 percent either side', () => {
    expect(backoffMs(2, () => 0)).toBe(3200)
    expect(backoffMs(2, () => 1)).toBe(4800)
  })
})

describe('call starts', () => {
  test('a key that has not proven itself starts one call per gap', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time)
    const starts: number[] = []
    for (let call = 0; call < 4; call += 1) {
      const ticket = await pacer.begin()
      starts.push(ticket?.startedAt ?? -1)
    }
    const gaps = starts.slice(1).map((at, index) => at - (starts[index] ?? 0))
    expect(gaps).toEqual([1000, 1000, 1000])
  })

  test('13 callers in one moment are spread out, never two starts inside the gap', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time)
    const tickets = await Promise.all(Array.from({ length: 13 }, () => pacer.begin()))
    const starts = tickets.map((ticket) => ticket?.startedAt ?? -1)
    for (let index = 1; index < starts.length; index += 1) {
      expect((starts[index] ?? 0) - (starts[index - 1] ?? 0)).toBeGreaterThanOrEqual(1000)
    }
  })

  test('a stop during a wait ends it: the call must not start', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time)
    await pacer.begin()
    let stop = false
    const second = pacer.begin(() => stop)
    stop = true
    expect(await second).toBeNull()
  })
})

describe('the limit on calls at once', () => {
  async function drain(
    pacer: CallPacer,
    calls: number,
    hold: () => Promise<void>
  ): Promise<number> {
    let open = 0
    let most = 0
    await Promise.all(
      Array.from({ length: calls }, () =>
        pacer.limiter.run(async () => {
          open += 1
          most = Math.max(most, open)
          await hold()
          open -= 1
        })
      )
    )
    return most
  }

  test('starts at 1 and never runs more than the limit', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time)
    expect(pacer.state().limit).toBe(1)
    const most = await drain(pacer, 8, () => new Promise((resolve) => setImmediate(resolve)))
    expect(most).toBe(1)
  })

  test('a streak of successes opens it step by step, up to the maximum', () => {
    const time = fakeTime()
    const pacer = pacerOf(time)
    const limits: number[] = []
    for (let call = 0; call < 12; call += 1) {
      pacer.succeeded()
      limits.push(pacer.state().limit)
    }
    expect(limits).toEqual([1, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4, 4])
    expect(pacer.state().limit).toBe(PACING.cloro.maxLimit)
  })

  test('an opened limit lets waiting calls start at once', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { initialLimit: 1 })
    let open = 0
    let most = 0
    const hold: Array<() => void> = []
    const runs = Array.from({ length: 4 }, () =>
      pacer.limiter.run(async () => {
        open += 1
        most = Math.max(most, open)
        await new Promise<void>((resolve) => hold.push(resolve))
        open -= 1
      })
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(open).toBe(1)
    pacer.succeeded()
    pacer.succeeded()
    await new Promise((resolve) => setImmediate(resolve))
    expect(open).toBe(2)
    for (let turn = 0; turn < 8; turn += 1) {
      for (const release of hold.splice(0)) release()
      await new Promise((resolve) => setImmediate(resolve))
    }
    await Promise.all(runs)
    expect(most).toBe(2)
  })

  test('a 429 halves it, never below 1', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { initialLimit: 4 })
    const ticket = (await pacer.begin()) ?? { startedAt: 0 }
    pacer.rateLimited(ticket, null)
    expect(pacer.state().limit).toBe(2)
    time.advance(120_000)
    const second = (await pacer.begin()) ?? { startedAt: 0 }
    pacer.rateLimited(second, null)
    expect(pacer.state().limit).toBe(1)
    time.advance(120_000)
    const third = (await pacer.begin()) ?? { startedAt: 0 }
    pacer.rateLimited(third, null)
    expect(pacer.state().limit).toBe(1)
  })

  test('after a 429 the limit opens again more slowly', () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { initialLimit: 2 })
    pacer.rateLimited({ startedAt: time.now() }, null)
    expect(pacer.state().limit).toBe(1)
    pacer.succeeded()
    pacer.succeeded()
    pacer.succeeded()
    expect(pacer.state().limit).toBe(1)
    pacer.succeeded()
    expect(pacer.state().limit).toBe(2)
  })
})

describe('the shared cooldown', () => {
  test('a 429 without Retry-After stops every new call for 2 s, then 4 s, 8 s ...', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const waits: number[] = []
    for (let wave = 0; wave < 7; wave += 1) {
      const ticket = (await pacer.begin()) ?? { startedAt: 0 }
      const before = time.waited()
      const verdict = pacer.rateLimited(ticket, null)
      waits.push(verdict.waitMs)
      await pacer.begin()
      expect(time.waited() - before).toBe(verdict.waitMs)
    }
    expect(waits).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000])
  })

  test('a success clears the backoff steps', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const first = (await pacer.begin()) ?? { startedAt: 0 }
    pacer.rateLimited(first, null)
    const second = (await pacer.begin()) ?? { startedAt: 0 }
    expect(pacer.rateLimited(second, null).waitMs).toBe(4000)
    await pacer.begin()
    pacer.succeeded()
    const third = (await pacer.begin()) ?? { startedAt: 0 }
    expect(pacer.rateLimited(third, null).waitMs).toBe(2000)
  })

  test('Retry-After in seconds is waited exactly', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const ticket = (await pacer.begin()) ?? { startedAt: 0 }
    expect(pacer.rateLimited(ticket, 7000)).toEqual({ waitMs: 7000, giveUp: false })
    const before = time.waited()
    await pacer.begin()
    expect(time.waited() - before).toBe(7000)
  })

  test('Retry-After as a date is waited too (the capture turns it into milliseconds)', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const { parseRetryAfter } = await import('../../providers/retry')
    const date = new Date(time.now() + 9000).toUTCString()
    const ms = parseRetryAfter(date, time.now())
    // An HTTP date has whole seconds, so the wait is within a second of 9 s.
    expect(ms).not.toBeNull()
    const ticket = (await pacer.begin()) ?? { startedAt: 0 }
    const verdict = pacer.rateLimited(ticket, ms)
    expect(verdict.waitMs).toBeGreaterThan(7900)
    expect(verdict.waitMs).toBeLessThanOrEqual(9000)
  })

  test('a Retry-After of minutes is not waited for: the call gives up, no shared cooldown', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const ticket = (await pacer.begin()) ?? { startedAt: 0 }
    const verdict = pacer.rateLimited(ticket, MAX_RETRY_AFTER_MS + 1000)
    expect(verdict).toEqual({ waitMs: 0, giveUp: true })
    const before = time.waited()
    await pacer.begin()
    expect(time.waited()).toBe(before)
  })

  test('the 429s of one burst are one wave: one halving, one backoff step', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { initialLimit: 4, minGapMs: 0 })
    const tickets = await Promise.all(Array.from({ length: 13 }, () => pacer.begin()))
    // All 13 started together; the provider refused 12 of them in the same second.
    const verdicts = tickets
      .slice(0, 12)
      .map((ticket) => pacer.rateLimited(ticket ?? { startedAt: 0 }, null))
    expect(pacer.state().strikes).toBe(1)
    expect(pacer.state().limit).toBe(2)
    expect(new Set(verdicts.map((verdict) => verdict.waitMs))).toEqual(new Set([2000]))
  })

  test('the cooldown stops every worker: none starts before it ends', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const ticket = (await pacer.begin()) ?? { startedAt: 0 }
    const refusedAt = time.now()
    pacer.rateLimited(ticket, 5000)
    const starts = await Promise.all(Array.from({ length: 13 }, () => pacer.begin()))
    for (const start of starts) {
      expect(start?.startedAt ?? 0).toBeGreaterThanOrEqual(refusedAt + 5000)
    }
  })

  test('a cooldown pushed while a worker sleeps is waited out too', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const first = (await pacer.begin()) ?? { startedAt: 0 }
    pacer.rateLimited(first, 3000)
    const slow = pacer.begin()
    // Meanwhile another call that started earlier is refused with a longer Retry-After.
    pacer.rateLimited({ startedAt: first.startedAt }, 6000)
    const ticket = await slow
    expect(ticket?.startedAt ?? 0).toBeGreaterThanOrEqual(first.startedAt + 6000)
  })

  test('listeners hear about a new cooldown, and can stop listening', async () => {
    const time = fakeTime()
    const pacer = pacerOf(time, { minGapMs: 0 })
    const heard: number[] = []
    const stop = pacer.onSlowed((event) => heard.push(event.waitMs))
    const first = (await pacer.begin()) ?? { startedAt: 0 }
    pacer.rateLimited(first, null)
    expect(heard).toEqual([2000])
    stop()
    const second = (await pacer.begin()) ?? { startedAt: 0 }
    pacer.rateLimited(second, null)
    expect(heard).toEqual([2000])
  })
})
