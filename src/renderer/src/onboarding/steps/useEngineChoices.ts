import { useEffect, useRef, useState } from 'react'
import {
  CLORO_CREDITS,
  ENGINE_IDS,
  ENGINE_LABEL,
  type EngineId,
  type SearchProvider
} from '@shared/domain'
import type { EngineEstimate, EngineOption } from '@shared/ipc'
import type { SetupServices } from '../setupServices'

/** How long quick ticks wait before the estimate is asked again. */
const ESTIMATE_DELAY_MS = 200

/** Every engine with cloro's list credits, until `engines:get` answers. */
export function fallbackOptions(): EngineOption[] {
  return ENGINE_IDS.map((id) => ({
    id,
    label: ENGINE_LABEL[id],
    credits: CLORO_CREDITS[id],
    needsCloro: id !== 'google_aio',
    runnable: true
  }))
}

/**
 * Step 7's engine list (`engines:get` options: label and credits) and the plan the
 * cost is priced at (`engines:estimate`, asked again a moment after each change).
 * Before the project exists both fall back to cloro's price list.
 */
export function useEngineChoices(
  services: SetupServices,
  projectId: string | null,
  provider: SearchProvider,
  engines: readonly EngineId[]
): { options: readonly EngineOption[]; estimate: EngineEstimate | null } {
  const [options, setOptions] = useState<readonly EngineOption[]>(fallbackOptions)
  const [estimate, setEstimate] = useState<EngineEstimate | null>(null)
  const asked = useRef(0)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    services['engines:get']({ projectId }).then(
      (view) => {
        if (!cancelled && view.options.length > 0) setOptions(view.options)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [services, projectId])

  const key = `${provider}:${engines.join(',')}`
  useEffect(() => {
    if (projectId === null) return
    const ticket = ++asked.current
    const [chosen, list] = key.split(':')
    const timer = window.setTimeout(() => {
      services['engines:estimate']({
        projectId,
        engines: (list ?? '')
          .split(',')
          .filter((id): id is EngineId => id.length > 0) as EngineId[],
        provider: chosen === 'serpapi' ? 'serpapi' : 'cloro'
      }).then(
        (next) => {
          if (ticket === asked.current) setEstimate(next)
        },
        () => undefined
      )
    }, ESTIMATE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [services, projectId, key])

  return { options, estimate }
}
