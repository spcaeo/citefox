// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueueStatus } from '@shared/domain'
import type { CheckFinishedNotice, PageList, ProjectIdRequest } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { ENGINE_UPDATE_DELAY_MS } from '../shell/useEngineUpdates'
import type { ShellClient } from './client'
import { createMockShellClient } from './mockClient'
import { useShellData } from './useShellData'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

interface Counted {
  client: ShellClient
  calls: Map<string, number>
  emitFinished: (notice: CheckFinishedNotice) => void
  emitQueue: (status: QueueStatus) => void
}

function countedClient(): Counted {
  const base = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore('textbolt')
  })
  const calls = new Map<string, number>()
  const finished = new Set<(notice: CheckFinishedNotice) => void>()
  const queue = new Set<(status: QueueStatus) => void>()
  const counted = new Proxy(base, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver)
      if (typeof key !== 'string' || typeof value !== 'function') return value
      return (...args: unknown[]) => {
        calls.set(key, (calls.get(key) ?? 0) + 1)
        return Reflect.apply(value, target, args)
      }
    }
  })
  const client: ShellClient = {
    ...counted,
    listProjects: () => counted.listProjects(),
    getProject: (request) => counted.getProject(request),
    getProjectSchedule: (request) => counted.getProjectSchedule(request),
    listPages: (request) => counted.listPages(request),
    pinnedPages: (request) => counted.pinnedPages(request),
    onCheckFinished(listener) {
      finished.add(listener)
      return () => finished.delete(listener)
    },
    onQueueStatus(listener) {
      queue.add(listener)
      return () => queue.delete(listener)
    }
  }
  return {
    client,
    calls,
    emitFinished: (notice) => {
      for (const listener of finished) listener(notice)
    },
    emitQueue: (status) => {
      for (const listener of queue) listener(status)
    }
  }
}

describe('useShellData', () => {
  it('a pin toggle refetches only the pages, not every project and schedule', async () => {
    const { client, calls } = countedClient()
    const { result } = renderHook(() => useShellData(client))
    await waitFor(() => {
      expect(result.current.ready).toBe(true)
    })
    expect(result.current.active?.id).toBe('textbolt')
    const page = result.current.pages[0]
    if (!page) throw new Error('expected a page')
    calls.clear()
    await act(async () => {
      await client.pinPage({ projectId: 'textbolt', pageId: page.id })
      await result.current.refreshPages()
    })
    expect(calls.get('getProject') ?? 0).toBe(0)
    expect(calls.get('getProjectSchedule') ?? 0).toBe(0)
    expect(calls.get('listProjects') ?? 0).toBe(0)
    expect(calls.get('listPages')).toBe(1)
    expect(result.current.pinned.some((item) => item.id === page.id)).toBe(true)
  })

  it('never shows the previous project when an older load answers last', async () => {
    const { client } = countedClient()
    let slowTextbolt = false
    const listPages = client.listPages
    client.listPages = async (request: ProjectIdRequest): Promise<PageList> => {
      const list = await listPages(request)
      if (slowTextbolt && request.projectId === 'textbolt') {
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      return list
    }
    const { result } = renderHook(() => useShellData(client))
    await waitFor(() => {
      expect(result.current.ready).toBe(true)
    })
    slowTextbolt = true
    await act(async () => {
      const stale = result.current.reload()
      await result.current.selectProject('acme')
      await stale
    })
    expect(result.current.active?.id).toBe('acme')
    expect(result.current.pages.every((page) => page.projectId === 'acme')).toBe(true)
  })

  it('reloads the shell once after a burst of pushed check events', async () => {
    const { client, calls, emitFinished, emitQueue } = countedClient()
    const { result } = renderHook(() => useShellData(client))
    await waitFor(() => {
      expect(result.current.ready).toBe(true)
    })
    const status = await client.getQueueStatus()
    calls.clear()
    vi.useFakeTimers()
    act(() => {
      emitFinished(notice('textbolt'))
      emitFinished(notice('acme'))
      emitQueue({ ...status, pagesDue: 7 })
    })
    expect(result.current.scores.queue?.pagesDue).not.toBe(7)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ENGINE_UPDATE_DELAY_MS + 10)
    })
    vi.useRealTimers()
    await waitFor(() => {
      expect(result.current.revision).toBe(1)
    })
    expect(calls.get('listPages')).toBe(1)
    expect(calls.get('listProjectScores')).toBe(1)
    expect(calls.get('getCapsule')).toBe(1)
    expect(calls.get('getProjectSchedule')).toBe(2)
    expect(calls.get('getQueueStatus') ?? 0).toBe(0)
    expect(result.current.scores.queue?.pagesDue).toBe(7)
  })
})

function notice(projectId: string): CheckFinishedNotice {
  return {
    jobId: `job-${projectId}`,
    projectId,
    pageId: 'page',
    pageLabel: 'Page',
    marketId: 'us-en',
    pageCited: 1,
    aiosShown: 2,
    pageCitedChange: null,
    score: 50,
    scoreChange: null,
    contentChanged: false
  }
}
