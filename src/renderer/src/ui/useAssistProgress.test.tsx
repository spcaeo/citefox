// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AssistProgress } from '@shared/ipc'
import {
  emitLocalAssistProgress,
  playMockSteps,
  resetAssistProgressForTests
} from '../assist/progress'
import { AssistProgressStore, matchesChannel, useAssistProgress } from './useAssistProgress'

function event(partial: Partial<AssistProgress> = {}): AssistProgress {
  return {
    runId: 'run-1',
    channel: 'assist:run',
    scope: 'page.promises',
    stepId: 's1',
    kind: 'read',
    label: 'Reading your saved data',
    state: 'running',
    detail: null,
    startedAt: Date.now(),
    endedAt: null,
    claude: null,
    ...partial
  }
}

beforeEach(() => resetAssistProgressForTests())
afterEach(cleanup)

describe('AssistProgressStore', () => {
  it('ignores events while idle and collects matching runs while active', () => {
    const store = new AssistProgressStore()
    store.push(event())
    expect(store.getSnapshot().steps).toEqual([])
    store.sync(true, { channel: 'assist:run', scope: 'page.promises' }, Date.now())
    store.push(event())
    store.push(event({ state: 'done', endedAt: Date.now() + 10 }))
    store.push(event({ runId: 'other', scope: 'markets.suggest' }))
    store.push(event({ runId: 'topics', channel: 'topics:discoverSeed' }))
    const view = store.getSnapshot()
    expect(view.running).toBe(true)
    expect(view.steps.map((step) => [step.key, step.state])).toEqual([['run-1:s1', 'done']])
  })

  it('stops taking new runs when the call ends, but lands late end events', () => {
    const store = new AssistProgressStore()
    store.sync(true, { channel: 'topics:', scope: null }, Date.now())
    store.push(event({ channel: 'topics:matchPages', kind: 'claude', label: 'Asking CiteFox AI' }))
    store.sync(false, { channel: 'topics:', scope: null }, Date.now())
    store.push(event({ channel: 'topics:matchPages', state: 'done', endedAt: Date.now() }))
    store.push(event({ runId: 'later', channel: 'topics:matchPages' }))
    const view = store.getSnapshot()
    expect(view.running).toBe(false)
    expect(view.endedAt).not.toBeNull()
    expect(view.steps.map((step) => step.state)).toEqual(['done'])
  })

  it('drops runs that started before the screen turned active', () => {
    const store = new AssistProgressStore()
    store.sync(true, { channel: null, scope: null }, Date.now())
    store.push(event({ runId: 'old', startedAt: Date.now() - 60_000 }))
    expect(store.getSnapshot().steps).toEqual([])
  })

  it('replays steps pushed a moment before the screen turned active', () => {
    const early = event({ label: 'Reading textbolt.com' })
    const store = new AssistProgressStore(() => [early])
    store.sync(true, { channel: 'assist:run', scope: null }, Date.now())
    expect(store.getSnapshot().steps.map((step) => step.label)).toEqual(['Reading textbolt.com'])
  })

  it('keeps the latest AI connection', () => {
    const store = new AssistProgressStore()
    store.sync(true, { channel: null, scope: null }, Date.now())
    store.push(
      event({
        kind: 'claude',
        claude: {
          connection: 'anthropic-api',
          connectionText: 'CiteFox AI · Anthropic API key',
          model: 'm'
        }
      })
    )
    expect(store.getSnapshot().claude?.connection).toBe('anthropic-api')
  })

  it('matches channels exactly or by a prefix ending in a colon', () => {
    expect(matchesChannel(null, 'assist:run')).toBe(true)
    expect(matchesChannel('topics:', 'topics:discoverSeed')).toBe(true)
    expect(matchesChannel('assist:run', 'assist:runner')).toBe(false)
  })
})

describe('useAssistProgress', () => {
  it('shows a mock run step by step and freezes when the call ends', async () => {
    const hook = renderHook(
      ({ active }) => useAssistProgress(active, 'assist:run', 'page.promises'),
      {
        initialProps: { active: false }
      }
    )
    hook.rerender({ active: true })
    await act(async () => {
      await playMockSteps(
        {
          channel: 'assist:run',
          scope: 'page.promises',
          steps: [
            { kind: 'read', label: 'Reading your saved data', ms: 0 },
            { kind: 'claude', label: 'Asking CiteFox AI', ms: 0 }
          ]
        },
        0
      )
    })
    expect(hook.result.current.steps.map((step) => `${step.label}:${step.state}`)).toEqual([
      'Reading your saved data:done',
      'Asking CiteFox AI:done'
    ])
    hook.rerender({ active: false })
    act(() => emitLocalAssistProgress(event({ runId: 'next', stepId: 's9' })))
    expect(hook.result.current.running).toBe(false)
    expect(hook.result.current.steps).toHaveLength(2)
    // A new call starts from an empty list: the run just shown is not replayed, a new one is.
    hook.rerender({ active: true })
    expect(hook.result.current.steps.map((step) => step.key)).toEqual(['next:s9'])
  })
})
