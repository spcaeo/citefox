// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockShellClient } from '../projects/mockClient'
import { useAppData } from './useAppData'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('useAppData', () => {
  it('never shows a made-up status capsule when the capsule call fails', async () => {
    const client = createMockShellClient()
    client.getCapsule = () => Promise.reject(new Error('Not implemented: status:getCapsule'))
    const { result } = renderHook(() => useAppData(client))
    await waitFor(() => {
      expect(result.current.overview).not.toBeNull()
    })
    expect(result.current.capsule.searchesLeft).toBeNull()
    expect(result.current.capsule.issueCount).toBe(0)
    expect(JSON.stringify(result.current.capsule)).not.toContain('3992')
  })

  it('clears the load error once a reload succeeds', async () => {
    const client = createMockShellClient()
    const getSettings = client.getSettings
    let fail = true
    client.getSettings = () =>
      fail ? Promise.reject(new Error('Settings file is busy.')) : getSettings()
    const { result } = renderHook(() => useAppData(client))
    await waitFor(() => {
      expect(result.current.loadError).toBe('Settings file is busy.')
    })
    fail = false
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.loadError).toBeNull()
    expect(result.current.snapshot).not.toBeNull()
  })

  it('keeps the newest answer when two loads finish out of order', async () => {
    const client = createMockShellClient()
    const getCapsule = client.getCapsule
    let call = 0
    client.getCapsule = async () => {
      call += 1
      const capsule = await getCapsule()
      if (call === 2) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { ...capsule, searchesLeft: 1 }
      }
      return { ...capsule, searchesLeft: call === 3 ? 3 : 0 }
    }
    const { result } = renderHook(() => useAppData(client))
    await waitFor(() => {
      expect(call).toBe(1)
    })
    await act(async () => {
      const slow = result.current.reload()
      await result.current.reload()
      await slow
    })
    expect(result.current.capsule.searchesLeft).toBe(3)
  })
})
