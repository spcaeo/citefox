import type { AllPageRow } from '@shared/ipc'

/**
 * Pages · Tree: the site's folders built from page URLs (path segments), like a
 * site-structure report, with totals per folder. Pure, so 700–800 page sites build
 * in one pass and the tests can check every folder adds up to its children.
 *
 * `/blog/` with pages under it is a folder; the page at `/blog/` itself is the
 * folder's own page (`ownPage`), listed first under it and counted in its totals.
 * Queries and fragments are ignored for the folders; two URLs on one path are two
 * pages of the same name.
 */

/** What a tree row reads from an All pages row. */
export type TreePage = Pick<
  AllPageRow,
  'id' | 'url' | 'title' | 'label' | 'status' | 'pageCited' | 'aioPrompts' | 'citations'
>

/** Totals of a folder, or one page's own numbers. */
export interface TreeTotals {
  pages: number
  /** Tracked, setting up or paused. */
  tracked: number
  /** Searches citing the pages (latest full check, default market). */
  cited: number
  /** Searches with an AI Overview in those checks. */
  aio: number
  /** Links to the pages in those overviews. */
  citations: number
  /** Pages with a check. */
  checked: number
}

export interface TreeFolder {
  kind: 'folder'
  /** `/blog/`, `/blog/2026/`. The root is `/`. Opaque enough for a URL (a path on the own site). */
  path: string
  /** The last segment, `blog`. The root's is `/`. */
  name: string
  depth: number
  /** The page at this folder's own address, if there is one. */
  ownPage: TreePage | null
  folders: TreeFolder[]
  pages: TreePage[]
  totals: TreeTotals
}

const WORKING = new Set(['tracked', 'setting_up', 'paused'])

export function emptyTotals(): TreeTotals {
  return { pages: 0, tracked: 0, cited: 0, aio: 0, citations: 0, checked: 0 }
}

/** One page's numbers as totals. */
export function pageTotals(page: TreePage): TreeTotals {
  return {
    pages: 1,
    tracked: WORKING.has(page.status) ? 1 : 0,
    cited: page.pageCited ?? 0,
    aio: page.aioPrompts ?? 0,
    citations: page.citations ?? 0,
    checked: page.pageCited === null ? 0 : 1
  }
}

function add(into: TreeTotals, more: TreeTotals): void {
  into.pages += more.pages
  into.tracked += more.tracked
  into.cited += more.cited
  into.aio += more.aio
  into.citations += more.citations
  into.checked += more.checked
}

/** The path's segments, decoded: `/blog/how-to/` → ['blog', 'how-to']. */
export function segmentsOf(url: string): string[] {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split(/[?#]/u)[0] ?? ''
  }
  return path
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
}

function folder(path: string, name: string, depth: number): TreeFolder {
  return {
    kind: 'folder',
    path,
    name,
    depth,
    ownPage: null,
    folders: [],
    pages: [],
    totals: emptyTotals()
  }
}

/** Builds the folder tree. Removed pages are left out unless `includeRemoved`. */
export function buildPageTree(
  pages: readonly TreePage[],
  options: { includeRemoved?: boolean } = {}
): TreeFolder {
  const root = folder('/', '/', 0)
  const folders = new Map<string, TreeFolder>([['/', root]])
  const ensure = (segments: readonly string[]): TreeFolder => {
    let current = root
    let path = '/'
    for (const [index, segment] of segments.entries()) {
      path = `${path}${segment}/`
      let next = folders.get(path)
      if (next === undefined) {
        next = folder(path, segment, index + 1)
        folders.set(path, next)
        current.folders.push(next)
      }
      current = next
    }
    return current
  }
  const leaves: { page: TreePage; segments: string[] }[] = []
  for (const page of pages) {
    if (!options.includeRemoved && page.status === 'removed') continue
    const segments = segmentsOf(page.url)
    leaves.push({ page, segments })
    // Every folder is made before any page is placed, so `/blog/` finds its folder.
    ensure(segments.slice(0, -1))
  }
  for (const { page, segments } of leaves) {
    if (segments.length === 0) {
      if (root.ownPage === null) root.ownPage = page
      else root.pages.push(page)
      continue
    }
    const own = folders.get(`/${segments.join('/')}/`)
    if (own !== undefined && own.ownPage === null) {
      own.ownPage = page
      continue
    }
    ensure(segments.slice(0, -1)).pages.push(page)
  }
  sum(root)
  sortTree(root)
  return root
}

function sum(node: TreeFolder): TreeTotals {
  const totals = emptyTotals()
  if (node.ownPage) add(totals, pageTotals(node.ownPage))
  for (const page of node.pages) add(totals, pageTotals(page))
  for (const child of node.folders) add(totals, sum(child))
  node.totals = totals
  return totals
}

/** Folders with the most pages first; pages by path. */
function sortTree(node: TreeFolder): void {
  node.folders.sort((a, b) => b.totals.pages - a.totals.pages || a.name.localeCompare(b.name))
  node.pages.sort((a, b) => a.url.localeCompare(b.url))
  for (const child of node.folders) sortTree(child)
}

/** The folder at `path`, or null. */
export function findFolder(root: TreeFolder, path: string): TreeFolder | null {
  if (root.path === path) return root
  for (const child of root.folders) {
    if (path.startsWith(child.path)) return findFolder(child, path)
  }
  return null
}

/** The folders from the root down to `path` (for the breadcrumb). Empty when not found. */
export function folderTrail(root: TreeFolder, path: string): TreeFolder[] {
  const trail: TreeFolder[] = []
  let current: TreeFolder | null = root
  while (current !== null) {
    trail.push(current)
    if (current.path === path) return trail
    const here: TreeFolder = current
    current = here.folders.find((child) => path.startsWith(child.path)) ?? null
  }
  return []
}

/** Every page under a folder, its own page first (what a folder's count drills to). */
export function pagesUnder(node: TreeFolder): TreePage[] {
  const out: TreePage[] = node.ownPage ? [node.ownPage] : []
  out.push(...node.pages)
  for (const child of node.folders) out.push(...pagesUnder(child))
  return out
}

/**
 * Each page's folders, from the top folder down (the root left out), for the
 * tree grid's `path`. A folder's own page sits in that folder, first.
 */
export function folderTrails(root: TreeFolder): Map<string, readonly TreeFolder[]> {
  const out = new Map<string, readonly TreeFolder[]>()
  const walk = (node: TreeFolder, trail: readonly TreeFolder[]): void => {
    if (node.ownPage) out.set(node.ownPage.id, trail)
    for (const page of node.pages) out.set(page.id, trail)
    for (const child of node.folders) walk(child, [...trail, child])
  }
  walk(root, [])
  return out
}

/** Every folder path, most pages first at each level (the tree grid's group order). */
export function folderOrder(root: TreeFolder): string[] {
  const out: string[] = []
  const walk = (node: TreeFolder): void => {
    for (const child of node.folders) {
      out.push(child.path)
      walk(child)
    }
  }
  walk(root)
  return out
}
