import { describe, expect, test } from 'vitest'
import { REPORT_FIRST_TICK_MS, REPORT_TICK_MS, startDueReportLoop } from './due-report-loop'

function fakeTimers(): {
  timers: { set: (run: () => void, ms: number) => number; clear: (handle: unknown) => void }
  pending: Array<{ run: () => void; ms: number; id: number }>
  cleared: unknown[]
} {
  const pending: Array<{ run: () => void; ms: number; id: number }> = []
  const cleared: unknown[] = []
  let id = 0
  return {
    pending,
    cleared,
    timers: {
      set: (run, ms) => {
        id += 1
        pending.push({ run, ms, id })
        return id
      },
      clear: (handle) => cleared.push(handle)
    }
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('startDueReportLoop', () => {
  test('the running app sends due reports on a tick, keeps ticking, and stops', async () => {
    // Live: a weekly PDF report due at 04:21 was not sent while CiteFox ran in the tray.
    const fake = fakeTimers()
    let sends = 0
    const errors: unknown[] = []
    const stop = startDueReportLoop({
      deliver: async () => {
        sends += 1
        if (sends === 1) throw new Error('smtp down')
      },
      logger: { error: (_message: string, error?: unknown) => void errors.push(error) },
      timers: fake.timers
    })
    expect(fake.pending.map((item) => item.ms)).toEqual([REPORT_FIRST_TICK_MS])
    fake.pending.shift()?.run()
    await flush()
    expect(sends).toBe(1)
    expect(errors).toHaveLength(1)
    expect(fake.pending.map((item) => item.ms)).toEqual([REPORT_TICK_MS])
    fake.pending.shift()?.run()
    await flush()
    expect(sends).toBe(2)
    const last = fake.pending.at(-1)
    stop()
    expect(fake.cleared).toEqual([last?.id])
    last?.run()
    await flush()
    expect(sends).toBe(2)
  })
})
