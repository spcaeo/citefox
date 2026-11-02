import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SitemapOverview, StructureView } from '@shared/ipc'
import { marketLabel } from '../../shell/model'
import type { StructureClient } from '../client'
import type { MarketChoice, RunAction } from '../types'
import { errorText } from '../../components/errorText'

export interface StructureState {
  overview: SitemapOverview | null
  view: StructureView | null
  loadError: string | null
  /** Plain-language failure of the last action. */
  actionError: string | null
  /** Label of the action in flight, such as "Sync now". */
  busy: string | null
  markets: readonly MarketChoice[]
  reload: () => Promise<void>
  run: RunAction
  clearError: () => void
}

interface Loaded {
  projectId: string
  overview: SitemapOverview
  view: StructureView
}

export function messageOf(cause: unknown, fallback: string): string {
  return errorText(cause, fallback)
}

/**
 * Loads `sitemaps:get` and `structure:get` for the project, reloads them after
 * every action and when a sync finishes (`sitemaps:syncFinished`).
 */
export function useStructure(client: StructureClient, projectId: string | null): StructureState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<{ projectId: string; message: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const current = useRef(projectId)

  useEffect(() => {
    current.current = projectId
  }, [projectId])

  const reload = useCallback(
    (): Promise<void> =>
      projectId === null
        ? Promise.resolve()
        : fetchBoth(client, projectId).then((result) => {
            if (current.current !== projectId) return
            if ('message' in result) setLoadError(result)
            else {
              setLoaded(result)
              setLoadError(null)
            }
          }),
    [client, projectId]
  )

  useEffect(() => {
    if (projectId === null) return undefined
    let cancelled = false
    fetchBoth(client, projectId).then(
      (result) => {
        if (cancelled) return
        if ('message' in result) setLoadError(result)
        else setLoaded(result)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId])

  useEffect(() => {
    if (projectId === null) return undefined
    return client['sitemaps:syncFinished']((event) => {
      if (event.projectId === projectId) void reload()
    })
  }, [client, projectId, reload])

  const run: RunAction = useCallback(
    async <T>(label: string, call: () => Promise<T>): Promise<T | null> => {
      setBusy(label)
      setActionError(null)
      try {
        const result = await call()
        await reload()
        return result
      } catch (cause) {
        setActionError(messageOf(cause, `${label} did not finish. Try again.`))
        return null
      } finally {
        setBusy(null)
      }
    },
    [reload]
  )

  const mine = loaded !== null && loaded.projectId === projectId ? loaded : null
  const view = mine?.view ?? null
  const markets = useMemo(() => marketChoices(view), [view])

  return {
    overview: mine?.overview ?? null,
    view,
    loadError: loadError !== null && loadError.projectId === projectId ? loadError.message : null,
    actionError,
    busy,
    markets,
    reload,
    run,
    clearError: () => setActionError(null)
  }
}

function fetchBoth(
  client: StructureClient,
  projectId: string
): Promise<Loaded | { projectId: string; message: string }> {
  return Promise.all([
    client['sitemaps:get']({ projectId }),
    client['structure:get']({ projectId })
  ]).then(
    ([overview, view]) => ({ projectId, overview, view }),
    (cause: unknown) => ({
      projectId,
      message: messageOf(cause, 'Could not load the site structure.')
    })
  )
}

/** Every project market (default first), labelled, plus any id a silo uses that is not listed. */
function marketChoices(view: StructureView | null): MarketChoice[] {
  const choices: MarketChoice[] = (view?.markets ?? []).map((market) => ({
    id: market.id,
    label: marketLabel(market),
    market
  }))
  for (const silo of view?.silos ?? []) {
    for (const id of [...(silo.marketIds ?? []), ...silo.effectiveMarketIds]) {
      if (!choices.some((choice) => choice.id === id)) {
        choices.push({ id, label: `Market ${choices.length + 1}`, market: null })
      }
    }
  }
  return choices
}
