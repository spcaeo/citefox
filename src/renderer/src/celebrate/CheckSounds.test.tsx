// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResultsChanged } from '@shared/ipc'
import { CheckSounds } from './CheckSounds'
import { setCelebrate, setCelebrateSound } from './setting'

const listeners = new Set<(event: ResultsChanged) => void>()
const subscribe = (listener: (event: ResultsChanged) => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function push(state: ResultsChanged['state'], jobId = 'job-1'): void {
  act(() => {
    for (const listener of listeners) {
      listener({
        projectId: 'p1',
        jobId,
        pageId: 'g1',
        marketId: 'm1',
        promptId: state === 'running' ? 'q1' : null,
        state,
        done: 1,
        total: 3
      })
    }
  })
}

describe('CheckSounds', () => {
  const play = vi.fn()
  beforeEach(() => {
    play.mockClear()
    setCelebrate(true)
    setCelebrateSound(true)
  })
  afterEach(() => {
    cleanup()
    listeners.clear()
  })

  it('plays started once per check and done at the end', () => {
    render(<CheckSounds subscribe={subscribe} play={play} isActive={() => true} />)
    push('running')
    push('running')
    push('finished')
    expect(play.mock.calls).toEqual([['check-started'], ['check-done']])
  })

  it('a second check with a new id starts again', () => {
    render(<CheckSounds subscribe={subscribe} play={play} isActive={() => true} />)
    push('running', 'a')
    push('finished', 'a')
    push('running', 'b')
    expect(play.mock.calls).toEqual([['check-started'], ['check-done'], ['check-started']])
  })

  it('is silent with the sound switch off, in the background, and when stopped', () => {
    const active = { value: true }
    render(<CheckSounds subscribe={subscribe} play={play} isActive={() => active.value} />)
    setCelebrateSound(false)
    push('running', 'off')
    push('finished', 'off')
    setCelebrateSound(true)
    setCelebrate(false)
    push('running', 'cel')
    push('finished', 'cel')
    setCelebrate(true)
    active.value = false
    push('running', 'bg')
    push('finished', 'bg')
    active.value = true
    push('running', 'stop')
    play.mockClear()
    push('stopped', 'stop')
    expect(play).not.toHaveBeenCalled()
  })
})
