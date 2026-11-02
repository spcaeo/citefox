import { DEFAULT_CLAUDE_CONCURRENCY } from '@shared/domain'
import { RETRY_DELAY_CAP_MS } from '../providers/retry'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { manualClock } from '../scheduler/clock'
import type { DuePage } from '../scheduler/types'
import { assertId } from '../storage/values'
import { dueJobId } from './check-queue'
import { createCheckQueue, estimateCheckSearches } from './index'
import { capAllowance } from './usage'
import type { CapAlert, QueueKeyInput, QueueProjectInput, QueueWork } from './types'

const NOW = Date.parse('2026-05-01T12:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('estimate and allowance', () => {
  test('10 prompts, 1 market, 1 sample is 10 to 20 searches', () => {
    expect(estimateCheckSearches({ prompts: 10, markets: 1, samples: 1 })).toEqual({
      minSearches: 10,
      maxSearches: 20
    })
  })

  test('allow_10 adds floor(cap / 10) and the other rules do not', () => {
    expect(capAllowance(10, 'allow_10')).toBe(11)
    expect(capAllowance(9, 'allow_10')).toBe(9)
    expect(capAllowance(15, 'allow_10')).toBe(16)
    expect(capAllowance(10, 'pause')).toBe(10)
    expect(capAllowance(10, 'notify')).toBe(10)
  })
})

describe('check queue', () => {
  test('does not read Date.now', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now')
    })
    const queue = queueWith()
    expect(queue.status().state).toBe('running')
  })

  test('status matches the contract shape and defaults Claude concurrency to 2', () => {
    const queue = queueWith()
    const status = queue.status()
    expect(DEFAULT_CLAUDE_CONCURRENCY).toBe(2)
    expect(status.claudeConcurrency).toBe(2)
    expect(Object.keys(status).sort()).toEqual(
      [
        'claudeConcurrency',
        'claudeInFlight',
        'headlessJob',
        'keys',
        'nextRunAt',
        'pagesDue',
        'projects',
        'running',
        'state',
        'trayRunning',
        'waiting'
      ].sort()
    )
    expect(Object.keys(status.keys[0] ?? {}).sort()).toEqual(
      ['cap', 'keyId', 'name', 'planLimit', 'provider', 'state', 'used'].sort()
    )
    expect(Object.keys(status.projects[0] ?? {}).sort()).toEqual(
      ['cap', 'capRule', 'dedicatedKeyId', 'name', 'paused', 'projectId', 'used'].sort()
    )
  })

  test('starts the ready job before one whose time has not come', () => {
    const queue = queueWith()
    queue.enqueue(work({ id: 'later', notBefore: iso(NOW + 60_000) }))
    queue.enqueue(work({ id: 'ready', notBefore: iso(NOW - 1) }))
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'ready' } })
    expect(queue.dequeue()).toMatchObject({ ok: false, reason: 'not_before' })
  })

  test('pause all lets the running job finish and holds the rest until resume', () => {
    const queue = queueWith()
    queue.enqueue(work({ id: 'running' }))
    queue.enqueue(work({ id: 'waiting' }))
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'running' } })
    const paused = queue.pause('all')
    expect(paused).toMatchObject({ state: 'paused_all', running: 1, waiting: 1, nextRunAt: null })
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'paused_all' })
    expect(queue.complete('running')).toEqual({ ok: true, status: 'completed' })
    expect(queue.status()).toMatchObject({ state: 'paused_all', running: 0, waiting: 1 })
    queue.resume()
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'waiting' } })
  })

  test('pause for today clears at the next local midnight', () => {
    const clock = manualClock(NOW)
    const queue = queueWith(clock)
    queue.enqueue(work())
    queue.pause('today')
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'paused_today' })
    clock.set(Date.parse('2026-05-01T23:59:00.000Z'))
    expect(queue.status().state).toBe('paused_today')
    clock.set(Date.parse('2026-05-02T00:00:00.000Z'))
    expect(queue.status().state).toBe('running')
    expect(queue.dequeue()).toMatchObject({ ok: true })
  })

  test('pause for today uses the computer zone, not UTC midnight', () => {
    const clock = manualClock(Date.parse('2026-06-01T02:30:00.000Z'))
    const queue = createCheckQueue({
      clock,
      timeZone: 'America/New_York',
      keys: [key()],
      projects: [project()]
    })
    queue.pause('today')
    clock.set(Date.parse('2026-06-01T03:30:00.000Z'))
    expect(queue.status().state).toBe('paused_today')
    clock.set(Date.parse('2026-06-01T04:00:00.000Z'))
    expect(queue.status().state).toBe('running')
  })

  test('cancel removes a waiting job and only flags a running one', () => {
    const queue = queueWith()
    queue.enqueue(work({ id: 'run' }))
    queue.enqueue(work({ id: 'wait' }))
    queue.dequeue()
    expect(queue.cancel('wait')).toEqual({ ok: true, state: 'removed' })
    expect(queue.cancel('run')).toEqual({ ok: true, state: 'cancel_requested' })
    expect(queue.status()).toMatchObject({ running: 1, waiting: 0 })
    expect(queue.complete('run')).toEqual({ ok: true, status: 'cancelled' })
  })

  test('two follow-ups for the same page and markets stay distinct jobs', () => {
    const queue = queueWith()
    const list = {
      day: '2026-05-01',
      pages: [
        duePage({
          reason: 'follow_up',
          promptIds: ['p1'],
          marketIds: ['us'],
          fixId: 'fix-1'
        }),
        duePage({
          reason: 'follow_up',
          promptIds: ['p1'],
          marketIds: ['us'],
          fixId: 'fix-2'
        })
      ]
    }
    const pass = queue.checkDue(list)
    expect(pass.started).toBe(true)
    expect(pass.pages).toBe(2)
    expect(new Set(pass.jobIds).size).toBe(2)
    expect(pass.jobIds[0]).not.toBe(pass.jobIds[1])
    expect(pass.jobIds).toEqual(list.pages.map((page) => dueJobId(list.day, page)))
    expect(pass.jobIds.every((id) => assertId(id) === id)).toBe(true)
    const first = queue.dequeue()
    const second = queue.dequeue()
    expect(first).toMatchObject({ ok: true, job: { fixId: 'fix-1', reason: 'follow_up' } })
    expect(second).toMatchObject({ ok: true, job: { fixId: 'fix-2', reason: 'follow_up' } })
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'empty' })
  })

  test('a scheduled due item does not take a fix id', () => {
    const queue = queueWith()
    expect(() => queue.enqueue(work({ reason: 'scheduled', fixId: 'fix-1' }))).toThrow(/fix id/)
    const pass = queue.checkDue({
      day: '2026-05-01',
      pages: [duePage({ reason: 'catch_up' })]
    })
    expect(pass.jobIds[0]).not.toContain('fix-')
    const next = queue.dequeue()
    expect(next).toMatchObject({ ok: true, job: { reason: 'catch_up', fixId: undefined } })
  })

  test('checkDue skips a page whose check is already running', () => {
    const running = new Set(['page-1'])
    const queue = createCheckQueue({
      clock: manualClock(NOW),
      timeZone: 'UTC',
      keys: [key()],
      projects: [project()],
      pageRunning: (_projectId, pageId) => running.has(pageId)
    })
    const pass = queue.checkDue({
      day: '2026-05-01',
      pages: [duePage({ pageId: 'page-1' }), duePage({ pageId: 'page-2' })]
    })
    expect(pass.started).toBe(true)
    expect(pass.jobIds).toHaveLength(1)
    expect(queue.status().waiting).toBe(1)
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { pageId: 'page-2' } })
  })

  test('dequeue leaves a page waiting while its check is still running', () => {
    let busy = false
    const queue = createCheckQueue({
      clock: manualClock(NOW),
      timeZone: 'UTC',
      keys: [key()],
      projects: [project()],
      pageRunning: () => busy
    })
    queue.enqueue(work({ id: 'due', pageId: 'page-1' }))
    busy = true
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'empty' })
    expect(queue.status()).toMatchObject({ waiting: 1, running: 0 })
    busy = false
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { pageId: 'page-1' } })
  })

  test('dueJobId stays a storage id when the project and page ids are long', () => {
    const page = duePage({
      projectId: 'proj-8e16fa7b-0588-48dd-a5e8-109eb2c808a4',
      pageId: 'page-2f51d624-29af-4b67-80d2-549e5dff03fa'
    })
    const id = dueJobId('2026-10-20', page)
    expect(id).toBe(assertId(id))
    expect(id).toBe(dueJobId('2026-10-20', page))
    expect(id).not.toBe(
      dueJobId('2026-10-20', { ...page, pageId: 'page-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
    )
  })

  test('an empty checkDue does not block a page added later the same day', () => {
    const queue = queueWith()
    const empty = queue.checkDue({ day: '2026-05-01', pages: [] })
    expect(empty).toEqual({ started: true, jobIds: [], pages: 0 })
    const later = queue.checkDue({
      day: '2026-05-01',
      pages: [duePage({ pageId: 'page-new' })]
    })
    expect(later.started).toBe(true)
    expect(later.pages).toBe(1)
    expect(later.jobIds).toHaveLength(1)
    const again = queue.checkDue({
      day: '2026-05-01',
      pages: [duePage({ pageId: 'page-new' })]
    })
    expect(again).toEqual({ started: false, jobIds: later.jobIds, pages: 1 })
    expect(queue.status().waiting).toBe(1)
  })

  test('checkDue is idempotent for the local day and returns the same job ids', () => {
    const queue = queueWith()
    const list = {
      day: '2026-05-01',
      pages: [duePage({ pageId: 'a' }), duePage({ pageId: 'b', reason: 'catch_up' })]
    }
    const first = queue.checkDue(list, () => 1)
    expect(first.started).toBe(true)
    expect(first.pages).toBe(2)
    expect(first.jobIds).toHaveLength(2)
    expect(queue.status()).toMatchObject({ waiting: 2, pagesDue: 2 })
    const second = queue.checkDue(list, () => 1)
    expect(second).toEqual({ started: false, jobIds: first.jobIds, pages: 2 })
    expect(queue.status().waiting).toBe(2)
    expect(() => queue.checkDue({ day: '2026-05-02', pages: [] })).toThrow(/local date/)
  })

  test('check now runs while a project is paused and waits while the queue is paused', () => {
    const queue = queueWith(manualClock(NOW), { projects: [project({ paused: true })] })
    queue.enqueue(work({ id: 'scheduled', reason: 'scheduled' }))
    queue.enqueue(work({ id: 'now', reason: 'manual' }))
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'now', reason: 'manual' } })
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'paused_project' })
    queue.setProjects([project({ paused: false })])
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'scheduled' } })

    const held = queueWith()
    held.pause('all')
    expect(held.enqueue(work({ id: 'now', reason: 'manual' }))).toEqual({ ok: true, id: 'now' })
    expect(held.dequeue()).toEqual({ ok: false, reason: 'paused_all' })
    expect(held.status()).toMatchObject({ state: 'paused_all', waiting: 1, running: 0 })
    held.resume()
    expect(held.dequeue()).toMatchObject({ ok: true, job: { id: 'now' } })
  })

  test('Claude concurrency limits checks that need Claude and lets other checks pass', () => {
    const queue = queueWith(manualClock(NOW), { claudeConcurrency: 1 })
    queue.enqueue(work({ id: 'c1', needsClaude: true }))
    queue.enqueue(work({ id: 'c2', needsClaude: true }))
    queue.enqueue(work({ id: 'search', needsClaude: false }))
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'c1' } })
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'search' } })
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'claude_concurrency' })
    expect(queue.status()).toMatchObject({ running: 2, claudeInFlight: 1, claudeConcurrency: 1 })
  })

  test('pause and notify hold the project at its cap, and allow_10 permits the extra tenth', () => {
    const clock = manualClock(NOW)
    const held = queueWith(clock, { projects: [project({ cap: 10, capRule: 'pause' })] })
    held.enqueue(work({ id: 'fit', maxSearches: 10 }))
    expect(held.dequeue()).toMatchObject({ ok: true })
    held.enqueue(work({ id: 'over', maxSearches: 1 }))
    expect(held.dequeue()).toEqual({ ok: false, reason: 'project_cap', capRule: 'pause' })

    const notify = queueWith(manualClock(NOW), {
      projects: [project({ cap: 10, capRule: 'notify' })]
    })
    notify.enqueue(work({ maxSearches: 11 }))
    expect(notify.dequeue()).toEqual({ ok: false, reason: 'project_cap', capRule: 'notify' })

    const over = queueWith(manualClock(NOW), {
      projects: [project({ cap: 10, capRule: 'allow_10' })]
    })
    over.enqueue(work({ id: 'eleven', maxSearches: 11 }))
    expect(over.dequeue()).toMatchObject({ ok: true, job: { id: 'eleven' } })
    over.enqueue(work({ id: 'twelve', maxSearches: 12 }))
    expect(over.dequeue()).toEqual({ ok: false, reason: 'project_cap', capRule: 'allow_10' })
  })

  test('a blocked project does not stop another project on the shared queue', () => {
    const queue = queueWith(manualClock(NOW), {
      projects: [
        project({ projectId: 'full', cap: 1, capRule: 'pause' }),
        project({ projectId: 'open', cap: 5, capRule: 'pause' })
      ]
    })
    queue.enqueue(work({ id: 'full-job', projectId: 'full', maxSearches: 2 }))
    queue.enqueue(work({ id: 'open-job', projectId: 'open', maxSearches: 1 }))
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'open-job' } })
  })

  test('in_order fills each key to its cap, then the next', () => {
    const queue = queueWith(manualClock(NOW), {
      keys: [
        key({ keyId: 'a', rotationOrder: 1, cap: 2 }),
        key({ keyId: 'b', rotationOrder: 0, cap: 2 })
      ]
    })
    queue.enqueue(work({ maxSearches: 4 }))
    expect(queue.dequeue()).toMatchObject({ ok: true })
    expect(taken(queue, 'job-1', 4)).toEqual(['b', 'b', 'a', 'a'])
  })

  test('spread_evenly rotates one search at a time', () => {
    const queue = queueWith(manualClock(NOW), {
      rotation: 'spread_evenly',
      keys: [key({ keyId: 'a', rotationOrder: 0 }), key({ keyId: 'b', rotationOrder: 1 })]
    })
    queue.enqueue(work({ maxSearches: 3 }))
    expect(queue.dequeue()).toMatchObject({ ok: true })
    expect(taken(queue, 'job-1', 3)).toEqual(['a', 'b', 'a'])
    expect(queue.commitSearch('job-1', 's0')).toMatchObject({ ok: true, keyId: 'a', keyUsed: 1 })
    expect(queue.commitSearch('job-1', 's1')).toMatchObject({
      ok: true,
      keyId: 'b',
      projectUsed: 2
    })
    expect(queue.commitSearch('job-1', 's2')).toMatchObject({
      ok: true,
      keyId: 'a',
      keyUsed: 2,
      projectUsed: 3
    })
  })

  test('project_keys ignores a key that is not assigned, including one with an empty project list', () => {
    const queue = queueWith(manualClock(NOW), {
      rotation: 'project_keys',
      keys: [
        key({ keyId: 'shared', projectIds: [], rotationOrder: 0 }),
        key({ keyId: 'mine', projectIds: ['proj-1'], rotationOrder: 1, cap: 1 })
      ]
    })
    queue.enqueue(work({ maxSearches: 1 }))
    expect(queue.dequeue()).toMatchObject({ ok: true })
    expect(taken(queue, 'job-1', 1)).toEqual(['mine'])
  })

  test('an empty project list is shared in in_order, and an off key is skipped', () => {
    const queue = queueWith(manualClock(NOW), {
      keys: [
        key({ keyId: 'off', state: 'off', rotationOrder: 0 }),
        key({ keyId: 'shared', projectIds: [], rotationOrder: 1 })
      ]
    })
    queue.enqueue(work({ maxSearches: 1 }))
    expect(queue.dequeue()).toMatchObject({ ok: true })
    expect(queue.takeKey('job-1', 's0')).toMatchObject({ ok: true, keyId: 'shared' })
  })

  test('failover retries once on the next key and the follow-up stays on the key that searched', () => {
    const queue = queueWith(manualClock(NOW), {
      keys: [
        key({ keyId: 'a', rotationOrder: 0, cap: 5 }),
        key({ keyId: 'b', rotationOrder: 1, cap: 5 })
      ]
    })
    queue.enqueue(work({ maxSearches: 1 }))
    queue.dequeue()
    expect(queue.takeKey('job-1', 'prompt-1')).toMatchObject({ keyId: 'a' })
    const failed = queue.failSearch('job-1', 'prompt-1', {
      reason: 'failed',
      countFailedSearch: true
    })
    expect(failed).toEqual({ ok: true, keyId: 'b' })
    expect(queue.commitSearch('job-1', 'prompt-1')).toMatchObject({ ok: true, keyId: 'b' })
    expect(
      queue.failSearch('job-1', 'prompt-1', { reason: 'failed', countFailedSearch: false })
    ).toEqual({
      ok: false,
      reason: 'already_committed'
    })
    const follow = queue.commitFollowUp('job-1', 'prompt-1')
    expect(follow).toMatchObject({ ok: true, keyId: 'b', keyUsed: 2, projectUsed: 3 })
    const events = queue.drainEvents()
    expect(events.map((event) => event.kind)).toEqual(['failed', 'failover'])
    expect(queue.drainEvents()).toEqual([])
    const status = queue.status()
    expect(status.keys.map((item) => [item.keyId, item.used])).toEqual([
      ['a', 1],
      ['b', 2]
    ])
    expect(status.projects[0]?.used).toBe(3)
  })

  test('a rate limit requeues the job instead of failing it', () => {
    const clock = manualClock(NOW)
    const queue = queueWith(clock)
    queue.enqueue(work({ maxSearches: 1 }))
    expect(queue.dequeue()).toMatchObject({ ok: true })
    expect(queue.takeKey('job-1', 's0')).toMatchObject({ ok: true })
    const waited = queue.rateLimit('job-1', { retryAfter: '2' })
    expect(waited).toEqual({ ok: true, notBefore: iso(NOW + 2_000), attempt: 1, delayMs: 2_000 })
    expect(queue.status()).toMatchObject({ running: 0, waiting: 1 })
    expect(queue.status().projects[0]?.used).toBe(0)
    expect(queue.drainEvents().map((event) => event.kind)).toEqual(['rate_limited'])
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'not_before' })
    clock.set(NOW + 2_000)
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'job-1' } })

    expect(queue.takeKey('job-1', 's0')).toMatchObject({ ok: true })
    const backedOff = queue.rateLimit('job-1')
    expect(backedOff).toMatchObject({ ok: true, attempt: 2, delayMs: 400 })

    const capped = queueWith(manualClock(NOW))
    capped.enqueue(work({ maxSearches: 1 }))
    expect(capped.dequeue()).toMatchObject({ ok: true })
    expect(capped.rateLimit('job-1', { retryAfter: '120' })).toMatchObject({
      ok: true,
      delayMs: RETRY_DELAY_CAP_MS,
      notBefore: iso(NOW + RETRY_DELAY_CAP_MS)
    })
    expect(capped.rateLimit('job-1')).toEqual({ ok: false, reason: 'not_running' })
  })

  test('a dedicated key does not fail over, and a follow-up may pass its cap', () => {
    const queue = queueWith(manualClock(NOW), {
      keys: [key({ keyId: 'only', cap: 1 }), key({ keyId: 'other' })],
      projects: [project({ dedicatedKeyId: 'only', cap: 1, capRule: 'pause' })]
    })
    queue.enqueue(work({ maxSearches: 1 }))
    queue.dequeue()
    queue.takeKey('job-1', 'prompt-1')
    expect(
      queue.failSearch('job-1', 'prompt-1', { reason: 'failed', countFailedSearch: true })
    ).toEqual({
      ok: false,
      reason: 'dedicated_key'
    })
    expect(queue.commitFollowUp('job-1', 'prompt-1')).toMatchObject({
      ok: true,
      keyId: 'only',
      overCap: true
    })
    expect(queue.status().keys.find((item) => item.keyId === 'only')?.used).toBe(2)
  })

  test('usage resets on the local month boundary', () => {
    const january = Date.parse('2026-01-31T12:00:00.000Z')
    const clock = manualClock(january)
    const queue = queueWith(clock, { projects: [project({ cap: 10 })] })
    queue.enqueue(work({ maxSearches: 1, notBefore: iso(january - 1) }))
    queue.dequeue()
    queue.takeKey('job-1', 's0')
    queue.commitSearch('job-1', 's0')
    expect(queue.status().projects[0]?.used).toBe(1)
    queue.complete('job-1')
    clock.set(Date.parse('2026-02-01T00:00:00.000Z'))
    expect(queue.status().projects[0]?.used).toBe(0)
    expect(queue.status().keys[0]?.used).toBe(0)
  })

  test('notify emits one cap alert per project per month, and pause does not', () => {
    const alerts: CapAlert[] = []
    const notify = queueWith(manualClock(NOW), {
      projects: [project({ cap: 10, capRule: 'notify', name: 'TextBolt' })],
      onCapAlert: (alert) => {
        alerts.push(alert)
      }
    })
    notify.enqueue(work({ id: 'over', maxSearches: 11 }))
    expect(notify.dequeue()).toEqual({ ok: false, reason: 'project_cap', capRule: 'notify' })
    notify.enqueue(work({ id: 'over-again', maxSearches: 11 }))
    expect(notify.dequeue()).toEqual({ ok: false, reason: 'project_cap', capRule: 'notify' })
    expect(alerts).toEqual([
      {
        at: iso(NOW),
        projectId: 'proj-1',
        name: 'TextBolt',
        used: 0,
        cap: 10,
        month: '2026-05'
      }
    ])

    const pauseAlerts: CapAlert[] = []
    const pausing = queueWith(manualClock(NOW), {
      projects: [project({ cap: 10, capRule: 'pause' })],
      onCapAlert: (alert) => {
        pauseAlerts.push(alert)
      }
    })
    pausing.enqueue(work({ maxSearches: 11 }))
    expect(pausing.dequeue()).toEqual({ ok: false, reason: 'project_cap', capRule: 'pause' })
    expect(pauseAlerts).toEqual([])
  })

  test('finishing a job releases a reservation that was never searched', () => {
    const queue = queueWith(manualClock(NOW), { projects: [project({ cap: 1, capRule: 'pause' })] })
    queue.enqueue(work({ id: 'held', maxSearches: 1 }))
    queue.dequeue()
    queue.enqueue(work({ id: 'next', maxSearches: 1 }))
    expect(queue.dequeue()).toMatchObject({ ok: false, reason: 'project_cap' })
    queue.complete('held')
    expect(queue.dequeue()).toMatchObject({ ok: true, job: { id: 'next' } })
  })
})

function queueWith(
  clock = manualClock(NOW),
  patch: {
    claudeConcurrency?: number
    rotation?: 'in_order' | 'spread_evenly' | 'project_keys'
    keys?: readonly QueueKeyInput[]
    projects?: readonly QueueProjectInput[]
    onCapAlert?: (alert: CapAlert) => void
  } = {}
): ReturnType<typeof createCheckQueue> {
  return createCheckQueue({
    clock,
    timeZone: 'UTC',
    claudeConcurrency: patch.claudeConcurrency,
    rotation: patch.rotation,
    onCapAlert: patch.onCapAlert,
    keys: patch.keys ?? [key()],
    projects: patch.projects ?? [project()]
  })
}

function key(patch: Partial<QueueKeyInput> = {}): QueueKeyInput {
  return {
    keyId: 'key-1',
    name: 'Primary',
    provider: 'serpapi',
    cap: null,
    planLimit: null,
    state: 'ok',
    rotationOrder: 0,
    projectIds: [],
    ...patch
  }
}

function project(patch: Partial<QueueProjectInput> = {}): QueueProjectInput {
  return {
    projectId: 'proj-1',
    name: 'TextBolt',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false,
    ...patch
  }
}

function work(patch: Partial<QueueWork> = {}): QueueWork {
  const id = patch.id ?? 'job-1'
  return {
    id,
    projectId: 'proj-1',
    pageId: id,
    marketIds: ['us'],
    reason: 'scheduled',
    promptIds: null,
    needsClaude: false,
    maxSearches: 0,
    notBefore: iso(NOW - 1),
    ...patch
  }
}

function duePage(patch: Partial<DuePage> = {}): DuePage {
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    label: 'Alerts',
    title: 'Text alerts',
    url: 'https://textbolt.com/text-alerts',
    marketIds: ['us'],
    dueAt: iso(NOW - 1),
    intervalDays: 14,
    reason: 'scheduled',
    promptIds: null,
    ...patch
  }
}

function taken(queue: ReturnType<typeof createCheckQueue>, jobId: string, count: number): string[] {
  const keys: string[] = []
  for (let index = 0; index < count; index += 1) {
    const result = queue.takeKey(jobId, `s${index}`)
    if (!result.ok) throw new Error(result.reason)
    keys.push(result.keyId)
  }
  return keys
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}
