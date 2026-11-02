import type { CiteFoxApi } from '@shared/ipc'

/** The channels the page drawers (cluster, group, pick pages, move pages, rename) call. */
export const PAGES_DRAWER_CHANNELS = [
  'structure:get',
  'structure:clusterPages',
  'structure:groupPages',
  'structure:movePages',
  'structure:createCluster',
  'structure:splitCluster',
  'structure:deleteCluster',
  'structure:setPageRole',
  'structure:setGroupPages',
  'structure:createGroup',
  'structure:deleteGroup',
  'structure:trackCluster',
  'structure:suggestLinks',
  'import:track',
  'allpages:list',
  'topics:list',
  'grid:listViews',
  'grid:exportCsv',
  'pages:get',
  'pages:update'
] as const

export type PagesDrawerChannel = (typeof PAGES_DRAWER_CHANNELS)[number]

/** Production forwards to the preload bridge; tests pass another object. */
export type PagesDrawerClient = Pick<CiteFoxApi, PagesDrawerChannel>

export function createPagesDrawerClient(): PagesDrawerClient {
  const api = (): CiteFoxApi => {
    if (typeof window === 'undefined' || !window.citefox) {
      throw new Error('The preload bridge is missing.')
    }
    return window.citefox
  }
  const client: Partial<Record<PagesDrawerChannel, (...args: unknown[]) => unknown>> = {}
  for (const channel of PAGES_DRAWER_CHANNELS) {
    client[channel] = (...args: unknown[]) =>
      (api()[channel] as (...rest: unknown[]) => unknown)(...args)
  }
  return client as PagesDrawerClient
}
