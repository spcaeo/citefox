import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueuePauseScope, QueueStatus } from '@shared/domain'
import { checkError } from '../../m3/source'
import { useEngineRevision } from '../../shell/engineRevision'
import type { StatusSource } from '../source'
import type { StatusData } from '../types'

function settled<T>(result: PromiseSettledResult<T>, errors: string[], what: string): T | null {
  if (result.status === 'fulfilled') return result.value
  errors.push(`${what}: ${checkError(result.reason, 'could not load.')}`)
  return null
}

/**
 * Reads every Status channel once, then keeps the queue live from
 * `queue:status` pushes. `refresh` reads everything again.
 */
export function useStatusData(source: StatusSource): {
  data: StatusData | null
  refreshing: boolean
  refresh: () => Promise<void>
  pause: (scope: QueuePauseScope) => Promise<string | null>
  resume: () => Promise<string | null>
} {
  const [data, setData] = useState<StatusData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const ticket = useRef(0)
  const revision = useEngineRevision()

  const refresh = useCallback(async () => {
    const mine = ++ticket.current
    setRefreshing(true)
    const results = await Promise.allSettled([
      source['status:getCapsule'](),
      source['connections:getOverview'](),
      source['settings:get'](),
      source['queue:getStatus'](),
      source['email:getSettings'](),
      source['deliveries:list']({}),
      source['checks:listActive']({ projectId: null }),
      source['schedule:listDue']({ projectId: null }),
      source['projectSettings:usage'](),
      source['projects:list']()
    ])
    if (mine !== ticket.current) return
    const errors: string[] = []
    setData({
      capsule: settled(results[0], errors, 'Credits'),
      overview: settled(results[1], errors, 'Connections'),
      settings: settled(results[2], errors, 'Settings'),
      queue: settled(results[3], errors, 'Checks'),
      email: settled(results[4], errors, 'Email'),
      deliveries: settled(results[5], errors, 'Sent reports'),
      jobs: settled(results[6], errors, 'Running checks'),
      due: settled(results[7], errors, 'Due pages'),
      usage: settled(results[8], errors, 'Usage'),
      projects: settled(results[9], errors, 'Projects'),
      loadedAt: new Date().toISOString(),
      errors
    })
    setRefreshing(false)
  }, [source])

  useEffect(() => {
    void Promise.resolve().then(refresh)
    return () => {
      ticket.current += 1
    }
  }, [refresh, revision])

  useEffect(
    () =>
      source['queue:status']((queue) => {
        setData((current) => (current ? { ...current, queue } : current))
      }),
    [source]
  )

  async function applyQueue(work: () => Promise<QueueStatus>): Promise<string | null> {
    try {
      const queue = await work()
      setData((current) => (current ? { ...current, queue } : current))
      return null
    } catch (cause) {
      return checkError(cause, 'Could not change the checks.')
    }
  }

  return {
    data,
    refreshing,
    refresh,
    pause: (scope) => applyQueue(() => source['queue:pause']({ scope })),
    resume: () => applyQueue(() => source['queue:resume']())
  }
}
