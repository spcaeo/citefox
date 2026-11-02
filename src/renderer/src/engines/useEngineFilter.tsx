import { useCallback, useMemo, type ReactNode } from 'react'
import type { EngineId } from '@shared/domain'
import type { ListEngineFilter } from '../ui/listGrid/types'
import { useHashQuery } from '../utils/hashQuery'
import { EngineFilterBar, EngineFixed } from './EngineDots'
import { ENGINE_PARAM, parseEngineFilter, type EngineFilter } from './model'

const KEYS = [ENGINE_PARAM] as const

/** Google AI Overview alone: the lists whose rows come from its checks only. */
export const GOOGLE_ONLY: readonly EngineId[] = ['google_aio']

export interface EngineFilterState {
  /** The picked engine, or `all`. Always `all` while the screen offers one engine. */
  engine: EngineFilter
  setEngine: (next: EngineFilter) => void
  /** The control alone, for a screen without a list toolbar. Null with no engines. */
  control: ReactNode
  /** For a ListGrid's `engine` prop: the control in its fixed toolbar spot. */
  slot: ListEngineFilter
}

/**
 * One engine filter for every results screen (audit #4): All plus each engine's logo
 * with two or more engines, or one fixed logo with one, so its spot never moves. The
 * pick lives in the URL (`?engine=chatgpt`); an engine the screen does not offer reads
 * as All. The screen filters its own rows, such as with `hasEngine`.
 */
export function useEngineFilter(offered: readonly EngineId[]): EngineFilterState {
  const [query, setQuery] = useHashQuery(KEYS)
  const key = offered.join(',')
  const engines = useMemo(() => (key === '' ? [] : (key.split(',') as EngineId[])), [key])
  const engine = parseEngineFilter(query[ENGINE_PARAM], engines.length >= 2 ? engines : [])
  const setEngine = useCallback(
    (next: EngineFilter) => setQuery({ [ENGINE_PARAM]: next === 'all' ? null : next }),
    [setQuery]
  )
  const control = useMemo(() => {
    if (engines.length >= 2)
      return <EngineFilterBar compact engines={engines} value={engine} onChange={setEngine} />
    const only = engines[0]
    return only ? <EngineFixed engine={only} /> : null
  }, [engines, engine, setEngine])
  const slot = useMemo<ListEngineFilter>(
    () => ({ control, active: engine !== 'all', onReset: () => setEngine('all') }),
    [control, engine, setEngine]
  )
  return { engine, setEngine, control, slot }
}
