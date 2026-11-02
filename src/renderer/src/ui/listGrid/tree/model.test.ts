import { describe, expect, it } from 'vitest'
import {
  buildTree,
  flattenTree,
  formatOpen,
  groupId,
  openTestFor,
  parseOpen,
  sortTree,
  toggleOpen,
  type TreeLine
} from './model'
import { SEARCH_COLUMNS, SEARCH_TREE, searches, type Search } from './tree.fixtures'

function describeLines(lines: readonly TreeLine<Search>[]): string[] {
  return lines.map((line) =>
    line.kind === 'group'
      ? `${'  '.repeat(line.node.depth)}[${line.open ? '-' : '+'}] ${line.node.label} (${line.node.rows.length})`
      : line.kind === 'more'
        ? `${'  '.repeat(line.depth)}more ${line.hidden}`
        : `${'  '.repeat(line.depth)}${line.key}`
  )
}

describe('tree model', () => {
  it('groups leaves by their path and lists each leaf in every group above it', () => {
    const built = buildTree(searches(40), SEARCH_TREE)
    expect(built.root.groups.map((group) => group.label)).toEqual([
      'Problem',
      'Solution',
      'Compare',
      'Decide'
    ])
    const problem = built.root.groups[0]
    expect(problem?.rows).toHaveLength(10)
    // Every row adds up to its parent.
    for (const group of built.groups.values()) {
      const below =
        group.leaves.length + group.groups.reduce((sum, child) => sum + child.rows.length, 0)
      expect(below).toBe(group.rows.length)
    }
    expect(built.root.groups.reduce((sum, group) => sum + group.rows.length, 0)).toBe(40)
    expect(built.groups.size).toBe(4 + 16)
  })

  it('gives groups opaque ids that never carry the keys', () => {
    const id = groupId(['/blog/', 'nagios setup'])
    expect(id).toMatch(/^g[a-z0-9]+$/)
    expect(id).toBe(groupId(['/blog/', 'nagios setup']))
    expect(id).not.toBe(groupId(['/blog/']))
  })

  it('handles leaves at different depths, folders first', () => {
    type Page = { path: string }
    const pages: Page[] = [{ path: '/' }, { path: '/blog/a' }, { path: '/blog/2024/b' }]
    const built = buildTree(pages, {
      path: (row) =>
        row.path
          .split('/')
          .filter(Boolean)
          .slice(0, -1)
          .map((part) => ({ key: part, label: `/${part}/` }))
    })
    const lines = flattenTree(built.root, {
      rowKey: (row) => row.path,
      isOpen: () => true,
      showsAll: () => false,
      limit: null
    })
    expect(
      lines.map((line) =>
        line.kind === 'group'
          ? `${line.node.depth}:${line.node.label}`
          : line.kind === 'leaf'
            ? `${line.depth}:${line.key}`
            : 'more'
      )
    ).toEqual(['0:/blog/', '1:/2024/', '2:/blog/2024/b', '1:/blog/a', '0:/'])
  })

  it('shows closed groups only, then children of open ones up to the limit', () => {
    const built = buildTree(searches(40), SEARCH_TREE)
    const closed = flattenTree(built.root, {
      rowKey: (row) => row.id,
      isOpen: () => false,
      showsAll: () => false,
      limit: 3
    })
    expect(describeLines(closed)).toEqual([
      '[+] Problem (10)',
      '[+] Solution (10)',
      '[+] Compare (10)',
      '[+] Decide (10)'
    ])
    const problem = built.root.groups[0]
    const notCited = problem?.groups[0]
    const open = new Set([problem?.id, notCited?.id])
    const lines = flattenTree(built.root, {
      rowKey: (row) => row.id,
      isOpen: (id) => open.has(id),
      showsAll: () => false,
      limit: 1
    })
    expect(describeLines(lines).slice(0, 6)).toEqual([
      '[-] Problem (10)',
      '  [-] Not cited (3)',
      '    s1',
      '    more 2',
      '  [+] Your other page (3)',
      '  [+] Right page (2)'
    ])
  })

  it('never writes "Show 1 more": the last leaf shows instead', () => {
    const built = buildTree(searches(16), SEARCH_TREE)
    const lines = flattenTree(built.root, {
      rowKey: (row) => row.id,
      isOpen: () => true,
      showsAll: () => false,
      limit: 0
    })
    // Each result group holds one leaf: no "more" line for it.
    expect(lines.some((line) => line.kind === 'more')).toBe(false)
  })

  it('sorts siblings: groups by a column total, leaves by the column', () => {
    const built = buildTree(searches(40), SEARCH_TREE)
    sortTree(built.root, [{ key: 'odds', dir: 'desc' }], SEARCH_COLUMNS, 'text', SEARCH_TREE.order)
    const tops = built.root.groups.map((group) => Math.max(...group.rows.map((row) => row.odds)))
    expect([...tops].sort((a, b) => b - a)).toEqual(tops)
    for (const group of built.groups.values()) {
      const odds = group.leaves.map((row) => row.odds)
      expect([...odds].sort((a, b) => b - a)).toEqual(odds)
    }
    sortTree(built.root, [{ key: 'text', dir: 'desc' }], SEARCH_COLUMNS, 'text', SEARCH_TREE.order)
    expect(built.root.groups.map((group) => group.label)).toEqual([
      'Solution',
      'Problem',
      'Decide',
      'Compare'
    ])
    // A column with no group value keeps the default order for groups.
    sortTree(
      built.root,
      [{ key: 'results', dir: 'asc' }],
      SEARCH_COLUMNS,
      'text',
      SEARCH_TREE.order
    )
    expect(built.root.groups.map((group) => group.label)).toEqual([
      'Problem',
      'Solution',
      'Compare',
      'Decide'
    ])
  })

  it('keeps open groups as default, all, none or a list, in a short URL value', () => {
    expect(parseOpen(null)).toEqual({ kind: 'default' })
    expect(parseOpen('*')).toEqual({ kind: 'all' })
    expect(parseOpen('-')).toEqual({ kind: 'none' })
    const list = parseOpen('ga1,gb2,<x>')
    expect(list.kind === 'list' && [...list.ids]).toEqual(['ga1', 'gb2'])
    expect(formatOpen({ kind: 'list', ids: new Set() })).toBe('-')
    expect(formatOpen({ kind: 'all' })).toBe('*')
    expect(formatOpen({ kind: 'default' })).toBeNull()
  })

  it('starts every group closed, except a lone top group', () => {
    const built = buildTree(searches(40), SEARCH_TREE)
    const closed = openTestFor({ kind: 'default' }, built, undefined)
    expect([...built.groups.keys()].some(closed)).toBe(false)
    expect(openTestFor({ kind: 'all' }, built, undefined)('x')).toBe(true)
    const lone = buildTree(
      searches(40).filter((row) => row.stage === 'Problem'),
      SEARCH_TREE
    )
    const loneTest = openTestFor({ kind: 'default' }, lone, undefined)
    const [top] = lone.root.groups
    expect(top && loneTest(top.id)).toBe(true)
    expect(top?.groups.some((child) => loneTest(child.id))).toBe(false)
    // The caller's default wins while the URL names no open groups.
    const picked = openTestFor({ kind: 'default' }, built, (group) => group.label === 'Decide')
    expect([...built.groups.values()].filter((g) => picked(g.id)).map((g) => g.label)).toEqual([
      'Decide'
    ])
  })

  it('turns "all open" into a list when one group closes', () => {
    const every = (): string[] => ['a', 'b', 'c']
    const closed = toggleOpen({ kind: 'all' }, 'b', false, () => true, every)
    expect(closed.kind === 'list' && [...closed.ids]).toEqual(['a', 'c'])
    const opened = toggleOpen({ kind: 'default' }, 'b', true, () => false, every)
    expect(opened.kind === 'list' && [...opened.ids]).toEqual(['b'])
    const small = toggleOpen({ kind: 'default' }, 'a', false, () => true, every)
    // A default that opens some groups keeps them open when another one opens.
    const some = toggleOpen({ kind: 'default' }, 'c', true, (id) => id === 'a', every)
    expect(some.kind === 'list' && [...some.ids]).toEqual(['a', 'c'])
    expect(small.kind === 'list' && [...small.ids]).toEqual(['b', 'c'])
    const same = { kind: 'none' } as const
    expect(toggleOpen(same, 'a', false, () => false, every)).toBe(same)
  })
})
