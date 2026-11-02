import { describe, expect, test } from 'vitest'
import { CHECK_CANCELLED_MESSAGE } from '../engine/checks'
import { manualClock } from '../scheduler/clock'
import { createCheckQueue } from './check-queue'
import { applyCheckResult, fixtureCheckRunner } from './runner'
import type { QueueKeyInput, QueueProjectInput, QueueWork } from './types'

const NOW = Date.parse('2026-05-01T12:00:00.000Z')

describe('CheckRunner', () => {
  test('a fixture counts attempts per job and records the jobs it ran', async () => {
    const runner = fixtureCheckRunner((_job, attempt) =>
      attempt === 1
        ? { outcome: 'rate_limited', retryAfter: '1', searches: [] }
        : { outcome: 'ok', searches: [] }
    )
    const first = await runner.run(running('job-1'))
    const second = await runner.run(running('job-1'))
    const other = await runner.run(running('job-2'))
    expect(first).toMatchObject({ outcome: 'rate_limited', retryAfter: '1' })
    expect(second).toMatchObject({ outcome: 'ok' })
    expect(other).toMatchObject({ outcome: 'rate_limited' })
    expect(runner.jobs.map((job) => job.id)).toEqual(['job-1', 'job-1', 'job-2'])
  })

  test('commits the searches a check used and takes the job out of running', () => {
    const queue = openQueue()
    queue.enqueue(work())
    const started = queue.dequeue()
    if (!started.ok) throw new Error('expected a job')
    const applied = applyCheckResult(queue, started.job, {
      outcome: 'ok',
      searches: [{ slotId: 's1' }, { slotId: 's2' }]
    })
    expect(applied).toMatchObject({ outcome: 'ok', searchesCommitted: 2, capBlocked: false })
    expect(queue.status()).toMatchObject({ running: 0, waiting: 0 })
    expect(queue.status().keys[0]?.used).toBe(2)
  })

  test('requeues a rate-limited check and keeps searches already made', () => {
    const queue = openQueue()
    queue.enqueue(work())
    const started = queue.dequeue()
    if (!started.ok) throw new Error('expected a job')
    const applied = applyCheckResult(queue, started.job, {
      outcome: 'rate_limited',
      retryAfter: '2',
      searches: [{ slotId: 's1' }]
    })
    expect(applied.outcome).toBe('rate_limited')
    expect(queue.status()).toMatchObject({ running: 0, waiting: 1 })
    expect(queue.status().keys[0]?.used).toBe(1)
    expect(queue.status().nextRunAt).toBe(new Date(NOW + 2_000).toISOString())
  })

  test('redacts a secret in a failed check message', () => {
    const queue = openQueue()
    queue.enqueue(work())
    const started = queue.dequeue()
    if (!started.ok) throw new Error('expected a job')
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    const applied = applyCheckResult(
      queue,
      started.job,
      { outcome: 'error', message: `provider said ${secret}`, searches: [] },
      [secret]
    )
    expect(applied.outcome).toBe('error')
    expect(applied.message).not.toContain(secret)
    expect(applied.message).toContain('[REDACTED]')
    expect(queue.status().running).toBe(0)
  })

  test('an engine cancel is cancelled, commits searches already made, and is not requeued', () => {
    const queue = openQueue()
    queue.enqueue(work())
    const started = queue.dequeue()
    if (!started.ok) throw new Error('expected a job')
    const applied = applyCheckResult(queue, started.job, {
      outcome: 'error',
      message: CHECK_CANCELLED_MESSAGE,
      searches: [{ slotId: 's1' }]
    })
    expect(applied).toMatchObject({
      outcome: 'cancelled',
      searchesCommitted: 1,
      capBlocked: false,
      message: null
    })
    expect(queue.status()).toMatchObject({ running: 0, waiting: 0 })
    expect(queue.complete(started.job.id)).toEqual({ ok: false, reason: 'not_running' })
  })

  test('a queue cancel does not retry a rate-limited or failed job', () => {
    const queue = openQueue()
    queue.enqueue(work())
    const started = queue.dequeue()
    if (!started.ok) throw new Error('expected a job')
    expect(queue.cancel(started.job.id)).toEqual({ ok: true, state: 'cancel_requested' })
    const applied = applyCheckResult(queue, started.job, {
      outcome: 'rate_limited',
      retryAfter: '30',
      searches: []
    })
    expect(applied.outcome).toBe('cancelled')
    expect(queue.status()).toMatchObject({ running: 0, waiting: 0 })

    queue.enqueue(work({ id: 'job-2', pageId: 'page-2' }))
    const failed = queue.dequeue()
    if (!failed.ok) throw new Error('expected a job')
    queue.cancel(failed.job.id)
    const errorApplied = applyCheckResult(
      queue,
      { ...failed.job, cancelRequested: true },
      { outcome: 'error', message: 'boom', searches: [] }
    )
    expect(errorApplied).toMatchObject({ outcome: 'cancelled', message: null })
    expect(queue.status().waiting).toBe(0)
  })

  test('a check that finished stays ok when cancel was also requested', () => {
    const queue = openQueue()
    queue.enqueue(work())
    const started = queue.dequeue()
    if (!started.ok) throw new Error('expected a job')
    queue.cancel(started.job.id)
    const applied = applyCheckResult(
      queue,
      { ...started.job, cancelRequested: true },
      { outcome: 'ok', searches: [] }
    )
    expect(applied.outcome).toBe('ok')
    expect(queue.status()).toMatchObject({ running: 0, waiting: 0 })
  })
})

function openQueue(): ReturnType<typeof createCheckQueue> {
  return createCheckQueue({
    clock: manualClock(NOW),
    timeZone: 'UTC',
    keys: [key()],
    projects: [project()]
  })
}

function key(): QueueKeyInput {
  return {
    keyId: 'key-1',
    name: 'Primary',
    provider: 'serpapi',
    cap: null,
    planLimit: null,
    state: 'ok',
    rotationOrder: 0,
    projectIds: []
  }
}

function project(): QueueProjectInput {
  return {
    projectId: 'proj-1',
    name: 'TextBolt',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false
  }
}

function work(patch: Partial<QueueWork> = {}): QueueWork {
  return {
    id: 'job-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    ...patch,
    marketIds: ['us'],
    reason: 'scheduled',
    promptIds: null,
    needsClaude: false,
    maxSearches: 5,
    notBefore: new Date(NOW - 1).toISOString()
  }
}

function running(id: string): ReturnType<typeof work> & {
  partial: boolean
  startedAt: string
  cancelRequested: boolean
} {
  return {
    ...work(),
    id,
    pageId: id,
    partial: false,
    startedAt: new Date(NOW).toISOString(),
    cancelRequested: false
  }
}
