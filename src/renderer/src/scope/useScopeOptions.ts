import { useCallback, useEffect, useState } from 'react'
import type { CiteFoxApi } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { useEngineRevision } from '../shell/engineRevision'
import { scopePageFromRow } from './model'
import type { ScopeOptions, ScopeSet } from './types'

/** The channels the scope pickers read. Tests pass another object. */
export type ScopeSource = Pick<
  CiteFoxApi,
  'allpages:list' | 'structure:get' | 'topics:list' | 'grid:listViews'
>

/** The grid id All pages saves its views under (allPages/utils/presets ALL_PAGES_GRID). */
const ALL_PAGES_GRID = 'all-pages'

export function createScopeSource(): ScopeSource {
  const api = (): CiteFoxApi => {
    if (typeof window === 'undefined' || !window.citefox) {
      throw new Error('The preload bridge is missing.')
    }
    return window.citefox
  }
  return {
    'allpages:list': (request) => api()['allpages:list'](request),
    'structure:get': (request) => api()['structure:get'](request),
    'topics:list': (request) => api()['topics:list'](request),
    'grid:listViews': (request) => api()['grid:listViews'](request)
  }
}

/**
 * Pages, groups, clusters, topics and saved views of one project, in one
 * shape for every scope picker. Pages are required; the others fall back to
 * empty lists when their channel fails (a project with no structure yet).
 */
export async function loadScopeOptions(
  source: ScopeSource,
  projectId: string
): Promise<ScopeOptions> {
  const optional = <T>(promise: Promise<T>): Promise<T | null> =>
    promise.then(
      (value) => value,
      () => null
    )
  const [pages, structure, topics, views] = await Promise.all([
    source['allpages:list']({ projectId }),
    optional(Promise.resolve().then(() => source['structure:get']({ projectId }))),
    optional(Promise.resolve().then(() => source['topics:list']({ projectId }))),
    optional(
      Promise.resolve().then(() => source['grid:listViews']({ projectId, grid: ALL_PAGES_GRID }))
    )
  ])
  const groups: ScopeSet[] = (structure?.groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    kind: 'group',
    count: group.pageCount
  }))
  const clusters: ScopeSet[] = (structure?.clusters ?? []).map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    kind: 'cluster',
    count: cluster.pageCount
  }))
  const topicSets: ScopeSet[] = (topics?.topics ?? [])
    .filter((topic) => topic.status !== 'removed')
    .map((topic) => ({
      id: topic.id,
      name: topic.name,
      kind: 'topic',
      count: 0,
      questions: topic.questions + topic.keywords
    }))
  const viewSets: ScopeSet[] = (views?.views ?? []).map((view) => ({
    id: view.id,
    name: view.name,
    kind: 'view',
    count: 0,
    filter: view.state
  }))
  const rows = pages.rows.filter((row) => row.status !== 'removed')
  return {
    projectId,
    domain: pages.domain,
    pages: rows.map(scopePageFromRow),
    rows,
    groups,
    clusters,
    topics: topicSets,
    views: viewSets,
    markets: pages.markets,
    defaultMarketId: pages.defaultMarketId,
    searchesLeft: pages.searchesLeft
  }
}

export interface ScopeOptionsState {
  options: ScopeOptions | null
  error: string | null
  reload: () => void
}

/** `loadScopeOptions`, reloaded when a check or sync changes the engine's data. */
export function useScopeOptions(
  projectId: string | null,
  source: ScopeSource | null = null
): ScopeOptionsState {
  const revision = useEngineRevision()
  const [options, setOptions] = useState<ScopeOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (projectId === null) return
    let live = true
    void Promise.resolve()
      .then(() => loadScopeOptions(source ?? createScopeSource(), projectId))
      .then(
        (next) => {
          if (!live) return
          setOptions(next)
          setError(null)
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not load the pages.'))
        }
      )
    return () => {
      live = false
    }
  }, [projectId, source, revision, reloads])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { options, error, reload }
}
