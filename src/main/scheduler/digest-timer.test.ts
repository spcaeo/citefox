import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SaveAlertRuleRequest } from '@shared/ipc'
import type { AlertEmail, AlertSenders } from '../alerts/deliver'
import { createAlertRulesService } from '../alerts/service'
import { closeSeeds } from '../engine/checks/checks.test-helper'
import {
  openProgressSeed,
  PROGRESS_SEED,
  type ProgressSeed
} from '../handlers/progress.test-helper'
import { createLogger } from '../logging/logger'
import { manualClock } from './clock'
import {
  DIGEST_FIRST_TICK_MS,
  DIGEST_TICK_MS,
  startAlertDigestTimer,
  type DigestTimers
} from './digest-timer'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  closeSeeds()
})

const projectId = PROGRESS_SEED.projectId
const [ONE] = PROGRESS_SEED.prompts
const HOUR = 3_600_000

/** Timers a test fires by hand, in order. */
function fakeTimers(): DigestTimers & {
  pending: Array<{ run: () => void; ms: number }>
  fire(): void
} {
  const pending: Array<{ run: () => void; ms: number }> = []
  return {
    pending,
    set(run, ms) {
      const entry = { run, ms }
      pending.push(entry)
      return entry
    },
    clear(handle) {
      const at = pending.indexOf(handle as { run: () => void; ms: number })
      if (at >= 0) pending.splice(at, 1)
    },
    fire() {
      const next = pending.shift()
      if (next === undefined) throw new Error('no timer to fire')
      next.run()
    }
  }
}

function rule(): SaveAlertRuleRequest {
  return {
    projectId,
    id: null,
    name: 'Daily losses',
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: false,
    emailTo: ['ada@example.com'],
    slack: false,
    delivery: 'digest'
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

describe('daily alert digest timer (main process)', () => {
  test('sends a waiting digest once it is a day old, with no check in between', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'citefox-digest-'))
    directories.push(dir)
    const email: AlertEmail[] = []
    const senders: AlertSenders = {
      desktop: () => undefined,
      email: async (input) => {
        email.push(input)
        return true
      },
      slack: async () => true
    }
    const seed = openProgressSeed(dir, { alertSenders: senders })
    opened.push(seed)
    const h = seed.handlers
    const saved = await h['alerts:saveRule'](rule())
    await seed.check(PROGRESS_SEED.first)
    seed.bodies.set(`us|${ONE.text}`, 'google-competitor.json')
    await seed.check(PROGRESS_SEED.second)
    expect(email).toHaveLength(0)

    // The timer's own service, on a clock the test moves (the window's is the same code).
    const clock = manualClock(Date.parse(PROGRESS_SEED.second) + HOUR)
    let id = 0
    const service = createAlertRulesService({
      storage: seed.storage,
      logger: createLogger({ write: () => undefined }),
      now: () => new Date(clock.now()),
      createId: () => `digest-${(id += 1)}`,
      senders
    })
    const timers = fakeTimers()
    const flush = vi.fn(() => service.flushDueDigests())
    const stop = startAlertDigestTimer({
      flush,
      logger: createLogger({ write: () => undefined }),
      timers
    })
    expect(timers.pending.map((entry) => entry.ms)).toEqual([DIGEST_FIRST_TICK_MS])

    // An hour after it fired: not a day old yet, nothing goes out.
    timers.fire()
    await settle()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(email).toHaveLength(0)
    expect(timers.pending.map((entry) => entry.ms)).toEqual([DIGEST_TICK_MS])

    // A day later, no new check: the next tick sends the one digest.
    clock.set(Date.parse(PROGRESS_SEED.second) + 25 * HOUR)
    timers.fire()
    await settle()
    expect(email).toHaveLength(1)
    expect(email[0]?.subject).toBe('CiteFox daily digest: Daily losses (1 page)')
    expect(email[0]?.to).toEqual(['ada@example.com'])
    const log = await h['alerts:listLog']({ projectId, ruleId: saved.id })
    expect(log.entries[0]?.deliveredTo).toEqual(['Daily digest: 1 email'])

    // Sent once: later ticks find nothing waiting.
    timers.fire()
    await settle()
    expect(email).toHaveLength(1)

    stop()
    expect(timers.pending).toEqual([])
  })

  test('keeps ticking after a failed flush, and stops for good', async () => {
    const timers = fakeTimers()
    const errors: string[] = []
    const flush = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue(0)
    const stop = startAlertDigestTimer({
      flush,
      logger: { error: (message: string) => errors.push(message), info: () => undefined },
      timers
    })
    timers.fire()
    await settle()
    expect(errors).toEqual(['CiteFox could not send daily alert digests'])
    expect(timers.pending).toHaveLength(1)
    timers.fire()
    await settle()
    expect(flush).toHaveBeenCalledTimes(2)
    stop()
    expect(timers.pending).toHaveLength(0)
  })
})
