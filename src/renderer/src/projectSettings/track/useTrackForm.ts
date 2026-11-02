import { useCallback, useEffect, useRef, useState } from 'react'
import { normaliseEngines, type EngineId, type SearchProvider } from '@shared/domain'
import type { EngineCounts, EngineEstimate, ProjectEnginesView } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { pickedProvider, providerToSave, sameEngines } from './model'
import type { EnginesSettingsSource } from './source'

/** How long typing-speed clicks wait before the estimate is asked again. */
const ESTIMATE_DELAY_MS = 200

export interface TrackForm {
  view: ProjectEnginesView | null
  loadError: string | null
  reload: () => void
  /** Each engine's counts at the latest check, for the Unavailable chip. */
  counts: ReadonlyMap<EngineId, EngineCounts>
  engines: readonly EngineId[]
  provider: SearchProvider
  toggle: (engine: EngineId, on: boolean) => void
  setProvider: (provider: SearchProvider) => void
  dirty: boolean
  /** Undo every unsaved change. */
  reset: () => void
  /** The live price of what is on screen. Null while it loads or with no engine. */
  estimate: EngineEstimate | null
  estimateError: string | null
  save: () => Promise<void>
}

/**
 * "What to track": the saved engines and provider, the unsaved picks, and the
 * estimate of those picks from `engines:estimate` (asked again a moment after
 * each change, so the price is always shown before Save).
 */
export function useTrackForm(source: EnginesSettingsSource, projectId: string): TrackForm {
  const [view, setView] = useState<ProjectEnginesView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [counts, setCounts] = useState<ReadonlyMap<EngineId, EngineCounts>>(new Map())
  const [engines, setEngines] = useState<readonly EngineId[]>([])
  const [provider, setProviderState] = useState<SearchProvider>('serpapi')
  const [estimate, setEstimate] = useState<EngineEstimate | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const asked = useRef(0)

  const adopt = useCallback((next: ProjectEnginesView) => {
    setView(next)
    setEngines(next.engines)
    setProviderState(pickedProvider(next))
  }, [])

  useEffect(() => {
    let cancelled = false
    source['engines:get']({ projectId }).then(
      (next) => {
        if (cancelled) return
        adopt(next)
        setLoadError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(errorText(cause, 'Could not load what this project tracks.'))
      }
    )
    // The Unavailable chip is a nicety: without the summary every chip still says On or Off.
    source['engines:summary']({ projectId }).then(
      (summary) => {
        if (!cancelled) setCounts(new Map(summary.counts.map((row) => [row.engine, row])))
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, attempt, adopt])

  useEffect(() => {
    if (view === null || engines.length === 0) return
    const ticket = ++asked.current
    const timer = window.setTimeout(() => {
      source['engines:estimate']({ projectId, engines: [...engines], provider }).then(
        (next) => {
          if (ticket !== asked.current) return
          setEstimate(next)
          setEstimateError(null)
        },
        (cause: unknown) => {
          if (ticket !== asked.current) return
          setEstimateError(errorText(cause, 'Could not work out the cost.'))
        }
      )
    }, ESTIMATE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [source, projectId, view, engines, provider])

  const toggle = useCallback((engine: EngineId, on: boolean) => {
    setEngines((current) =>
      normaliseEngines(on ? [...current, engine] : current.filter((item) => item !== engine))
    )
  }, [])

  const dirty =
    view !== null && (!sameEngines(engines, view.engines) || provider !== pickedProvider(view))

  const reset = useCallback(() => {
    if (view !== null) adopt(view)
  }, [view, adopt])

  const save = useCallback(async () => {
    if (view === null) return
    const providerChoice = providerToSave(view, provider)
    const next = await source['engines:set']({
      projectId,
      engines: [...engines],
      ...(providerChoice !== undefined ? { provider: providerChoice } : {})
    })
    adopt(next)
  }, [source, projectId, view, engines, provider, adopt])

  return {
    view,
    loadError,
    reload: () => setAttempt((n) => n + 1),
    counts,
    engines,
    provider,
    toggle,
    setProvider: setProviderState,
    dirty,
    reset,
    // With no engine there is nothing to price; an older estimate is not shown.
    estimate: engines.length === 0 ? null : estimate,
    estimateError,
    save
  }
}
