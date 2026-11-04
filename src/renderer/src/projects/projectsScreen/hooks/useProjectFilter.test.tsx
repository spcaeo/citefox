// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectFilter } from '../../listModel'
import { useProjectFilter } from './useProjectFilter'

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/projects')
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '#/')
})

describe('Projects list filter in the URL', () => {
  it('writes status and kind, and leaves nothing for the empty filter', async () => {
    const { result } = renderHook(() => useProjectFilter())
    expect(result.current[0]).toEqual({ statuses: [], clients: [] })
    act(() => result.current[1]((now: ProjectFilter) => ({ ...now, statuses: ['Paused'] })))
    await settle()
    expect(window.location.hash).toBe('#/projects?pstatus=paused')
    expect(result.current[0].statuses).toEqual(['Paused'])
    act(() => result.current[1]((now: ProjectFilter) => ({ ...now, clients: ['Client'] })))
    await settle()
    expect(window.location.hash).toBe('#/projects?pstatus=paused&pkind=client')
    act(() => result.current[1]({ statuses: [], clients: [] }))
    await settle()
    expect(window.location.hash).toBe('#/projects')
  })

  it('reads a pasted link and ignores words it does not know', () => {
    window.history.replaceState(null, '', '#/projects?pstatus=active,nonsense&pkind=own')
    const { result } = renderHook(() => useProjectFilter())
    expect(result.current[0]).toEqual({ statuses: ['Active'], clients: ['Own'] })
  })
})
