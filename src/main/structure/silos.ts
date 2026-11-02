import type { SiloSummary } from '@shared/domain'
import type { StoredSilo } from '../storage/group-records'
import { folderSegments } from './url-rules'

/**
 * Silos from URL folders (FR-19.6). The tree has the site root, every
 * top-level folder, and second-level folders with at least
 * {@link MIN_NESTED_SILO_PAGES} pages. Deeper folders roll up into their
 * second-level ancestor. Folders are recomputed from the page list on every
 * read, so they follow each sitemap sync.
 */

export const ROOT_SILO = '/'
export const MIN_NESTED_SILO_PAGES = 3

export interface SiloPage {
  id: string
  url: string
  working: boolean
}

export interface SiloTree {
  silos: SiloSummary[]
  /** Deepest silo per page id. */
  pathOf: Map<string, string>
}

export function buildSilos(
  pages: readonly SiloPage[],
  settings: ReadonlyMap<string, StoredSilo>,
  defaultMarketIds: readonly string[]
): SiloTree {
  const counts = new Map<string, { pages: number; tracked: number }>()
  const chains = new Map<string, string[]>()
  const bump = (path: string, working: boolean): void => {
    const entry = counts.get(path) ?? { pages: 0, tracked: 0 }
    entry.pages += 1
    if (working) entry.tracked += 1
    counts.set(path, entry)
  }
  for (const page of pages) {
    const chain = candidateChain(page.url)
    chains.set(page.id, chain)
    bump(ROOT_SILO, page.working)
    for (const path of chain) bump(path, page.working)
  }
  const shown = new Set<string>([ROOT_SILO])
  for (const [path, count] of counts) {
    if (path === ROOT_SILO) continue
    const depth = depthOf(path)
    if (depth === 1 || (depth === 2 && count.pages >= MIN_NESTED_SILO_PAGES)) shown.add(path)
  }
  // A folder's landing page (`/blog/` itself) belongs to that folder's silo.
  for (const page of pages) {
    const own = landingPath(page.url)
    const chain = chains.get(page.id)
    if (own === null || chain === undefined || !shown.has(own) || chain.includes(own)) continue
    chains.set(page.id, [...chain, own])
    for (const path of [own]) bump(path, page.working)
  }
  const pathOf = new Map<string, string>()
  for (const [pageId, chain] of chains) {
    let deepest = ROOT_SILO
    for (const path of chain) if (shown.has(path)) deepest = path
    pathOf.set(pageId, deepest)
  }
  const ordered = [...shown].sort(comparePaths)
  const silos = ordered.map((path): SiloSummary => {
    const count = counts.get(path) ?? { pages: 0, tracked: 0 }
    const setting = settings.get(path)
    return {
      path,
      parentPath: parentOf(path),
      depth: path === ROOT_SILO ? 0 : depthOf(path),
      pageCount: count.pages,
      trackedCount: count.tracked,
      trackAll: setting?.trackAll ?? false,
      marketIds: setting?.marketIds ?? null,
      effectiveMarketIds: effectiveMarkets(path, settings, defaultMarketIds)
    }
  })
  return { silos, pathOf }
}

/** The markets after "Same as parent folder" is applied up to the root. */
export function effectiveMarkets(
  path: string,
  settings: ReadonlyMap<string, StoredSilo>,
  defaultMarketIds: readonly string[]
): string[] {
  let current: string | null = path
  while (current !== null) {
    const own = settings.get(current)?.marketIds
    if (own !== undefined && own !== null && own.length > 0) return [...own]
    current = parentOf(current)
  }
  return [...defaultMarketIds]
}

/** True when this folder or any folder above it tracks every page (FR-19.6). */
export function siloTracksAll(path: string, settings: ReadonlyMap<string, StoredSilo>): boolean {
  let current: string | null = path
  while (current !== null) {
    if (settings.get(current)?.trackAll === true) return true
    current = parentOf(current)
  }
  return false
}

/** Every folder path a page is under, shallow first, capped at two levels. */
export function candidateChain(url: string): string[] {
  const segments = folderSegments(url).slice(0, 2)
  const chain: string[] = []
  let path = '/'
  for (const segment of segments) {
    path = `${path}${segment}/`
    chain.push(path)
  }
  return chain
}

/** `/blog/` for the page `https://site/blog/`, at most two levels deep. */
function landingPath(url: string): string | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const parts = pathname.split('/').filter((part) => part.length > 0)
  if (parts.length === 0 || parts.length > 2) return null
  return `/${parts.join('/')}/`
}

export function parentOf(path: string): string | null {
  if (path === ROOT_SILO) return null
  const trimmed = path.slice(1, -1).split('/')
  trimmed.pop()
  return trimmed.length === 0 ? ROOT_SILO : `/${trimmed.join('/')}/`
}

function depthOf(path: string): number {
  return path.split('/').filter((part) => part.length > 0).length
}

function comparePaths(left: string, right: string): number {
  if (left === ROOT_SILO) return -1
  if (right === ROOT_SILO) return 1
  return left.localeCompare(right)
}
