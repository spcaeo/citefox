import type { GridSortKey } from '@shared/domain'
import { opaqueId } from '../../../drill/ids'
import { compareSortValues } from '../../../grid/model/rows'
import { sortOf } from '../columns'
import type { ListColumn, ListSortValue, ListTree, ListTreeGroup } from '../types'

/** Leaves under an open group before "Show N more", and the size of a tree whose open groups show every leaf. */
export const DEFAULT_MORE_AFTER = 3
export const DEFAULT_OPEN_ALL_UP_TO = 30

/** The tree column: the one the caller names, else the `fill` column, else the first. */
export function treeColumnId<Row>(
  columns: readonly ListColumn<Row>[],
  tree: ListTree<Row>
): string {
  if (tree.column && columns.some((column) => column.id === tree.column)) return tree.column
  return (columns.find((column) => column.width === 'fill') ?? columns[0])?.id ?? ''
}

/** Indent per level, and the arrow's width, so a leaf lines up with its group's label. */
export const TREE_INDENT = 24
export const TREE_CARET = 20

/** A group of the tree, built once per rows and search. */
export interface TreeNode<Row> {
  id: string
  key: string
  label: string
  lead?: ListTreeGroup<Row>['lead']
  depth: number
  path: readonly string[]
  /** Child groups, in first-seen order until sorted. */
  groups: TreeNode<Row>[]
  /** Leaves directly under this group, in row order until sorted. */
  leaves: Row[]
  /** Every leaf below, in row order. */
  rows: Row[]
  /** Place among its siblings when first seen, for a stable default order. */
  seen: number
}

export interface BuiltTree<Row> {
  root: TreeNode<Row>
  /** Every group by its opaque id. */
  groups: ReadonlyMap<string, TreeNode<Row>>
  leafCount: number
}

/** One drawn line of a tree grid. */
export type TreeLine<Row> =
  | { kind: 'group'; node: TreeNode<Row>; open: boolean }
  | { kind: 'leaf'; row: Row; key: string; depth: number; parent: TreeNode<Row> }
  | { kind: 'more'; node: TreeNode<Row>; hidden: number; depth: number }

/** The key a tree line's measured height is kept under. */
export function treeLineKey<Row>(line: TreeLine<Row>): string {
  if (line.kind === 'group') return `group:${line.node.id}`
  if (line.kind === 'more') return `more:${line.node.id}`
  return `row:${line.key}`
}

/** The group id the URL holds: opaque, stable for the same path of keys. */
export function groupId(path: readonly string[]): string {
  return `g${opaqueId(path.join('\u0001'))}`
}

function newNode<Row>(
  key: string,
  label: string,
  path: readonly string[],
  seen: number
): TreeNode<Row> {
  return {
    id: path.length === 0 ? '' : groupId(path),
    key,
    label,
    depth: path.length - 1,
    path,
    groups: [],
    leaves: [],
    rows: [],
    seen
  } as TreeNode<Row>
}

/** Groups the rows by their paths. Each leaf is listed in every group above it. */
export function buildTree<Row>(
  rows: readonly Row[],
  tree: Pick<ListTree<Row>, 'path'>
): BuiltTree<Row> {
  const root = newNode<Row>('', '', [], 0)
  const groups = new Map<string, TreeNode<Row>>()
  const children = new Map<TreeNode<Row>, Map<string, TreeNode<Row>>>()
  for (const row of rows) {
    let node = root
    root.rows.push(row)
    const steps = tree.path(row)
    for (const step of steps) {
      let kids = children.get(node)
      if (!kids) {
        kids = new Map()
        children.set(node, kids)
      }
      let child = kids.get(step.key)
      if (!child) {
        child = newNode<Row>(step.key, step.label, [...node.path, step.key], kids.size)
        if (step.lead !== undefined) child.lead = step.lead
        kids.set(step.key, child)
        node.groups.push(child)
        groups.set(child.id, child)
      }
      child.rows.push(row)
      node = child
    }
    node.leaves.push(row)
  }
  return { root, groups, leafCount: rows.length }
}

/** The group as callers see it (`renderGroup`, a column's `total`). */
export function publicGroup<Row>(node: TreeNode<Row>): ListTreeGroup<Row> {
  return {
    id: node.id,
    key: node.key,
    label: node.label,
    ...(node.lead !== undefined ? { lead: node.lead } : {}),
    depth: node.depth,
    path: node.path,
    rows: node.rows,
    children: node.groups.length + node.leaves.length
  }
}

type Compare<T> = (a: T, b: T) => number

function bySort<T>(
  sort: readonly GridSortKey[],
  value: (item: T, key: string) => ListSortValue | undefined
): Compare<T> | null {
  if (sort.length === 0) return null
  return (a, b) => {
    for (const key of sort) {
      const left = value(a, key.key)
      const right = value(b, key.key)
      // A column with no group value leaves the order as it is.
      if (left === undefined || right === undefined) continue
      // Empty values sort last in either direction.
      if (left === null || right === null) {
        if (left !== right) return left === null ? 1 : -1
        continue
      }
      const result = compareSortValues(left, right)
      if (result !== 0) return key.dir === 'desc' ? -result : result
    }
    return 0
  }
}

/**
 * Sorts siblings in place, top to bottom (a sorted copy of the tree is cheap
 * to rebuild, so the caller passes a fresh one). Groups sort by a column's
 * `totalSort`, the tree column by label; leaves by the column's sort. With no
 * sort, groups keep `order`, then first-seen order, and leaves keep row order.
 */
export function sortTree<Row>(
  root: TreeNode<Row>,
  sort: readonly GridSortKey[],
  columns: readonly ListColumn<Row>[],
  treeColumn: string,
  order: readonly string[] | undefined
): void {
  const byId = new Map(columns.map((column) => [column.id, column]))
  const leafCompare = bySort<Row>(sort, (row, key) => {
    const column = byId.get(key)
    const read = column ? sortOf(column) : null
    return read ? read(row) : undefined
  })
  const groupCompare = bySort<TreeNode<Row>>(sort, (node, key) => {
    const column = byId.get(key)
    if (column?.totalSort) return column.totalSort(node.rows)
    if (key === treeColumn) return node.label
    return undefined
  })
  const rank = new Map((order ?? []).map((key, at) => [key, at]))
  const defaultOrder: Compare<TreeNode<Row>> = (a, b) =>
    (rank.get(a.key) ?? rank.size + a.seen) - (rank.get(b.key) ?? rank.size + b.seen)
  const visit = (node: TreeNode<Row>): void => {
    node.groups.sort((a, b) => groupCompare?.(a, b) || 0 || defaultOrder(a, b))
    if (leafCompare) node.leaves.sort(leafCompare)
    for (const child of node.groups) visit(child)
  }
  visit(root)
}

export interface FlattenOptions<Row> {
  rowKey: (row: Row) => string
  isOpen: (id: string) => boolean
  /** True when an open group shows every leaf, past `limit`. */
  showsAll: (id: string) => boolean
  /** Leaves shown before "Show N more". Null shows all. */
  limit: number | null
}

/** The lines to draw: each open group's child groups, then its leaves (up to the limit). */
export function flattenTree<Row>(
  root: TreeNode<Row>,
  options: FlattenOptions<Row>
): TreeLine<Row>[] {
  const out: TreeLine<Row>[] = []
  const walk = (node: TreeNode<Row>, depth: number): void => {
    for (const child of node.groups) {
      const open = options.isOpen(child.id)
      out.push({ kind: 'group', node: child, open })
      if (open) walk(child, depth + 1)
    }
    const { limit } = options
    // "Show 1 more" would take a line to save a line: show the last one instead.
    const capped =
      limit !== null &&
      node !== root &&
      node.leaves.length > limit + 1 &&
      !options.showsAll(node.id)
    const shown = capped ? node.leaves.slice(0, limit) : node.leaves
    for (const row of shown) {
      out.push({ kind: 'leaf', row, key: options.rowKey(row), depth, parent: node })
    }
    if (capped) out.push({ kind: 'more', node, hidden: node.leaves.length - shown.length, depth })
  }
  walk(root, 0)
  return out
}

/** Every group id, top down (Expand all, and turning "all open" into a list). */
export function allGroupIds<Row>(built: BuiltTree<Row>): string[] {
  return [...built.groups.keys()]
}

/** The open groups: the default (closed, see `openTestFor`), everything, nothing, or a list. */
export type OpenState =
  | { kind: 'default' }
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'list'; ids: ReadonlySet<string> }

/** `<key>.open` in the URL: `*` every group, `-` none, else a comma list of ids. */
export function parseOpen(value: string | null): OpenState {
  if (value === null || value === '') return { kind: 'default' }
  if (value === '*') return { kind: 'all' }
  if (value === '-') return { kind: 'none' }
  return { kind: 'list', ids: new Set(value.split(',').filter((id) => /^[a-z0-9]+$/.test(id))) }
}

export function formatOpen(state: OpenState): string | null {
  switch (state.kind) {
    case 'default':
      return null
    case 'all':
      return '*'
    case 'none':
      return '-'
    case 'list':
      return state.ids.size === 0 ? '-' : [...state.ids].join(',')
  }
}

/**
 * True when the group shows its children. Every tree starts closed (owner
 * 2026-10-30, "trees start collapsed, with Expand all"), except a lone top
 * group, which would only be one line that says nothing; a caller's
 * `defaultOpen` decides instead while the URL names no open groups.
 */
export function openTestFor<Row>(
  state: OpenState,
  built: BuiltTree<Row>,
  defaultOpen: ListTree<Row>['defaultOpen']
): (id: string) => boolean {
  switch (state.kind) {
    case 'all':
      return () => true
    case 'none':
      return () => false
    case 'list':
      return (id) => state.ids.has(id)
    case 'default': {
      if (defaultOpen) {
        return (id) => {
          const node = built.groups.get(id)
          return node ? defaultOpen(publicGroup(node)) : false
        }
      }
      const top = built.root.groups
      const lone = top.length === 1 && built.root.leaves.length === 0 ? top[0]?.id : undefined
      return (id) => id === lone
    }
  }
}

/**
 * The open state after one group opens or closes. `isOpen` is what shows now
 * (the default may open some groups and not others); from anything but a
 * list, the groups open now become the list.
 */
export function toggleOpen(
  state: OpenState,
  id: string,
  open: boolean,
  isOpen: (id: string) => boolean,
  every: () => readonly string[]
): OpenState {
  if (isOpen(id) === open) return state
  const ids = new Set(state.kind === 'list' ? state.ids : every().filter(isOpen))
  if (open) ids.add(id)
  else ids.delete(id)
  return { kind: 'list', ids }
}
