import { describe, expect, test } from 'vitest'
import {
  buildPageTree,
  findFolder,
  folderOrder,
  folderTrail,
  folderTrails,
  pagesUnder,
  segmentsOf,
  type TreeFolder,
  type TreePage
} from './model'

let next = 0
function page(path: string, extra: Partial<TreePage> = {}): TreePage {
  next += 1
  return {
    id: `pg${next}`,
    url: `https://textbolt.com${path}`,
    title: null,
    label: null,
    status: 'tracked',
    pageCited: 2,
    aioPrompts: 5,
    citations: 3,
    ...extra
  }
}

/** Every folder's totals equal the sum of its own page, pages and sub-folders. */
function expectAddsUp(node: TreeFolder): void {
  const parts = [
    ...(node.ownPage ? [1] : []),
    ...node.pages.map(() => 1),
    ...node.folders.map((child) => child.totals.pages)
  ]
  expect(node.totals.pages, node.path).toBe(parts.reduce((a, b) => a + b, 0))
  expect(pagesUnder(node)).toHaveLength(node.totals.pages)
  for (const child of node.folders) expectAddsUp(child)
}

describe('buildPageTree', () => {
  const pages = [
    page('/'),
    page('/pricing'),
    page('/blog/'),
    page('/blog/a-post'),
    page('/blog/2026/b-post', {
      status: 'not_tracked',
      pageCited: null,
      aioPrompts: null,
      citations: null
    }),
    page('/blog/2026/c-post?ref=1'),
    page('/integration/nagios'),
    page('/integration/zabbix/'),
    page('/old', { status: 'removed' })
  ]
  const root = buildPageTree(pages)

  test('folders from path segments, own pages on their folder', () => {
    expect(root.ownPage?.url).toBe('https://textbolt.com/')
    expect(root.folders.map((folder) => folder.path)).toEqual(['/blog/', '/integration/'])
    const blog = findFolder(root, '/blog/')
    expect(blog?.ownPage?.url).toBe('https://textbolt.com/blog/')
    expect(blog?.folders.map((folder) => folder.name)).toEqual(['2026'])
    expect(findFolder(root, '/blog/2026/')?.pages).toHaveLength(2)
    // A page with a trailing slash and nothing under it is a page, not a folder.
    expect(findFolder(root, '/integration/')?.pages.map((p) => p.url)).toEqual([
      'https://textbolt.com/integration/nagios',
      'https://textbolt.com/integration/zabbix/'
    ])
  })

  test('totals add up at every level; removed pages are left out', () => {
    expect(root.totals.pages).toBe(8)
    expectAddsUp(root)
    const blog = findFolder(root, '/blog/')
    expect(blog?.totals).toEqual({
      pages: 4,
      tracked: 3,
      cited: 6,
      aio: 15,
      citations: 9,
      checked: 3
    })
    expect(buildPageTree(pages, { includeRemoved: true }).totals.pages).toBe(9)
  })

  test("each page's folder trail, and the folder order", () => {
    const trails = folderTrails(root)
    const names = (id: string | undefined): string[] =>
      (trails.get(id ?? '') ?? []).map((folder) => folder.path)
    expect(names(pages[0]?.id)).toEqual([])
    expect(names(pages[2]?.id)).toEqual(['/blog/'])
    expect(names(pages[4]?.id)).toEqual(['/blog/', '/blog/2026/'])
    expect(names(pages[7]?.id)).toEqual(['/integration/'])
    expect(trails.has(pages[8]?.id ?? '')).toBe(false)
    expect(trails.size).toBe(8)
  })

  test('trail, paths and segments', () => {
    expect(folderTrail(root, '/blog/2026/').map((folder) => folder.name)).toEqual([
      '/',
      'blog',
      '2026'
    ])
    expect(folderTrail(root, '/nope/')).toEqual([])
    expect(folderOrder(root)).toEqual(['/blog/', '/blog/2026/', '/integration/'])
    expect(segmentsOf('https://x.com/a%20b/c/?q=1#f')).toEqual(['a b', 'c'])
  })

  test('800 pages build in one go', () => {
    const many = Array.from({ length: 800 }, (_, i) => page(`/s${i % 8}/t${i % 40}/p${i}`))
    const big = buildPageTree(many)
    expect(big.totals.pages).toBe(800)
    expect(big.folders).toHaveLength(8)
    expectAddsUp(big)
  })
})
