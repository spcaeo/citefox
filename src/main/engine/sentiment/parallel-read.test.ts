import { afterEach, describe, expect, test } from 'vitest'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { listSentimentClaims, listSentimentReads } from '../../storage/sentiment-records'
import { createLimiter } from '../checks/check-pace'
import { closeSeeds, NOW } from '../checks/checks.test-helper'
import { createCheckEngine } from '../checks/engine'
import { readRunSentiment } from './read'
import { fixtureClaude, seedSentiment } from './sentiment.test-helper'
import { fullRuns } from './view'

/**
 * Owner, 2026-10-29: after a check, the sentiment read and the answer shapes asked
 * Claude one overview at a time (12 overviews took over four minutes). Now each run's
 * overviews are read side by side, and the two steps run together, never more than
 * Settings' "Calls at once" in flight.
 */

afterEach(() => {
  closeSeeds()
})

const START = {
  projectId: 'proj-1',
  pageIds: ['page-1'],
  marketIds: null,
  promptIds: null
} as const

/** `fixtureClaude` that answers a little later and counts the calls in flight by kind. */
function timedClaude(seen: string[] = []): ClaudeProvider & {
  most: () => number
  overlapped: () => boolean
} {
  const inner = fixtureClaude(seen)
  const running = new Map<string, number>()
  let most = 0
  let overlapped = false
  return {
    id: 'claude-code',
    async complete(request) {
      const kind = request.prompt.includes('classifying the blocks of one Google AI Overview')
        ? 'shape'
        : 'other'
      running.set(kind, (running.get(kind) ?? 0) + 1)
      const total = [...running.values()].reduce((sum, value) => sum + value, 0)
      most = Math.max(most, total)
      if ((running.get('shape') ?? 0) > 0 && (running.get('other') ?? 0) > 0) overlapped = true
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return await inner.complete(request)
      } finally {
        running.set(kind, (running.get(kind) ?? 1) - 1)
      }
    },
    most: () => most,
    overlapped: () => overlapped
  }
}

describe('sentiment read side by side', () => {
  test('a limiter of two reads two overviews at once and stores the same claims', async () => {
    const seeded = await seedSentiment({})
    await seeded.handlers['checks:start'](START)
    const runs = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us')
    const run = runs.at(-1)
    if (run === undefined) throw new Error('no run')
    let sequence = 0
    const read = (
      claude: ClaudeProvider,
      limiter?: ReturnType<typeof createLimiter>
    ): ReturnType<typeof readRunSentiment> =>
      readRunSentiment(
        {
          db: seeded.projectDb,
          appDb: seeded.storage.db,
          claude,
          logger: seeded.checkDeps.logger,
          now: () => NOW,
          createId: () => {
            sequence += 1
            return `read-${sequence}`
          },
          ...(limiter !== undefined ? { limiter } : {})
        },
        { projectId: 'proj-1', runId: run.id }
      )
    const one = await read(fixtureClaude())
    const serialClaims = listSentimentClaims(seeded.projectDb, [run.id])
      .map((claim) => claim.sentence)
      .sort()
    // Clear the stored reads and the call cache so every overview is read again.
    seeded.projectDb.prepare('DELETE FROM sentiment_reads').run()
    seeded.projectDb.prepare('DELETE FROM generations').run()
    const claude = timedClaude()
    const two = await read(claude, createLimiter(2))
    expect(claude.most()).toBe(2)
    expect(two.overviews).toBe(one.overviews)
    expect(two.read + two.reused).toBe(one.read + one.reused)
    expect(two.failed).toBe(0)
    expect(
      listSentimentClaims(seeded.projectDb, [run.id])
        .map((claim) => claim.sentence)
        .sort()
    ).toEqual(serialClaims)
    expect(listSentimentReads(seeded.projectDb, [run.id]).every((item) => item.ok)).toBe(true)
  })

  test('one overview that fails is stored as failed; the others are read', async () => {
    const seeded = await seedSentiment({})
    await seeded.handlers['checks:start'](START)
    const run = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us').at(-1)
    if (run === undefined) throw new Error('no run')
    const inner = fixtureClaude()
    let calls = 0
    const claude: ClaudeProvider = {
      id: 'claude-code',
      async complete(request) {
        calls += 1
        // The very first call fails; every other call answers.
        if (calls === 1) throw new Error('Claude timed out')
        return inner.complete(request)
      }
    }
    let sequence = 0
    const result = await readRunSentiment(
      {
        db: seeded.projectDb,
        appDb: seeded.storage.db,
        claude,
        logger: seeded.checkDeps.logger,
        now: () => NOW,
        createId: () => {
          sequence += 1
          return `read-${sequence}`
        },
        limiter: createLimiter(2)
      },
      { projectId: 'proj-1', runId: run.id }
    )
    expect(result.overviews).toBeGreaterThan(1)
    expect(result.read + result.reused + result.failed).toBe(result.overviews)
    const reads = listSentimentReads(seeded.projectDb, [run.id])
    expect(reads.some((item) => item.ok)).toBe(true)
  })
})

describe('check reports: sentiment and answer shapes together', () => {
  test('both steps run at once, never more than "Calls at once" (2) in flight', async () => {
    const seeded = await seedSentiment({})
    expect(seeded.storage.readSettings().claudeConcurrency).toBe(2)
    const claude = timedClaude()
    const engine = createCheckEngine({ ...seeded.checkDeps, claude, readSentiment: true })
    const job = await engine.start(START)
    await engine.reportsIdle()
    expect(job.status).toBe('finished')
    expect(claude.most()).toBe(2)
    expect(claude.overlapped()).toBe(true)
    const runs = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us')
    // Same claims as the one-at-a-time read (sentiment.test.ts): 5 reviews + 3 pricing.
    expect(
      listSentimentClaims(
        seeded.projectDb,
        runs.map((run) => run.id)
      )
    ).toHaveLength(8)
  })
})
