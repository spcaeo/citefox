import { describe, expect, test } from 'vitest'
import { manualClock } from '../scheduler/clock'
import { createCheckQueue } from './check-queue'
import { memoryQueuePauseStore } from './pause-store'
import type { QueueKeyInput, QueueProjectInput, QueueWork } from './types'

const NOON = Date.parse('2026-05-01T12:00:00.000Z')

describe('persisted queue pause', () => {
  test('a pause made by one queue is honoured by a fresh queue that shares the store', () => {
    const clock = manualClock(NOON)
    const store = memoryQueuePauseStore()
    const gui = queueWith(clock, store)
    gui.pause('all')
    expect(store.read()).toEqual({ state: 'paused_all' })

    const headless = queueWith(clock, store)
    headless.enqueue(work())
    expect(headless.status().state).toBe('paused_all')
    expect(headless.dequeue()).toEqual({ ok: false, reason: 'paused_all' })

    headless.resume()
    expect(store.read()).toBeNull()
    expect(gui.status().state).toBe('running')
    expect(headless.dequeue()).toMatchObject({ ok: true })
  })

  test('pause today is stored with the local day and expires at local midnight', () => {
    const clock = manualClock(Date.parse('2026-05-01T21:30:00.000Z'))
    const store = memoryQueuePauseStore()
    const first = queueWith(clock, store, 'America/New_York')
    first.pause('today')
    expect(store.read()).toEqual({ state: 'paused_today', day: '2026-05-01' })

    // 23:59 local the same day: still paused, even in a new process.
    clock.set(Date.parse('2026-05-02T03:59:00.000Z'))
    expect(queueWith(clock, store, 'America/New_York').status().state).toBe('paused_today')

    // 00:01 local the next day: running again everywhere.
    clock.set(Date.parse('2026-05-02T04:01:00.000Z'))
    const later = queueWith(clock, store, 'America/New_York')
    expect(later.status().state).toBe('running')
    expect(first.status().state).toBe('running')
  })

  test('a resume in another process clears the pause in this one', () => {
    const clock = manualClock(NOON)
    const store = memoryQueuePauseStore()
    const gui = queueWith(clock, store)
    gui.pause('today')
    store.write(null)
    expect(gui.status().state).toBe('running')
  })
})

function queueWith(
  clock: ReturnType<typeof manualClock>,
  pauseStore: ReturnType<typeof memoryQueuePauseStore>,
  timeZone = 'UTC'
): ReturnType<typeof createCheckQueue> {
  return createCheckQueue({
    clock,
    timeZone,
    keys: [key()],
    projects: [project()],
    pauseStore
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

function work(): QueueWork {
  return {
    id: 'job-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    marketIds: ['us'],
    reason: 'scheduled',
    promptIds: null,
    needsClaude: false,
    maxSearches: 0,
    notBefore: new Date(NOON).toISOString()
  }
}
