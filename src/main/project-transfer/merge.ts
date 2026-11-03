import type { SqliteDatabase } from '../storage/database'
import {
  nounOf,
  policyFor,
  rowContext,
  sectionOf,
  type IdMapKind,
  type Row,
  type RowContext,
  type TablePolicy
} from './catalog'
import { mergeSettingsLists } from './competitors'
import {
  catalogTables,
  failureReason,
  insertSql,
  quoteName,
  rowIdentity,
  selectAll,
  type ForeignKey,
  type TableInfo
} from './schema'
import type { ImportTallies } from './tallies'

/**
 * Replace: the file goes into a project that already exists for the same site.
 * Its settings take the file's values (keys, keychain refs and timers of this
 * Mac stay). Everything else is added unless it is already there: the same
 * page address, topic name, market, product, group, alert rule or id is a
 * duplicate and is skipped together with what belongs to it, so nothing in the
 * project is removed and its check history stays.
 */

/** Settings this Mac keeps on Replace, beyond the catalog's local values. */
const KEEP_ON_REPLACE: Readonly<Record<string, readonly string[]>> = {
  project_schedule: ['paused']
}

/** Parents a row follows to the existing copy instead of being skipped with it. */
const FOLLOW: ReadonlySet<IdMapKind> = new Set(['market', 'product', 'group', 'cluster'])

/** Id columns that are not foreign keys but still name a market or a page. */
function extraMap(table: string, column: string): IdMapKind | null {
  if (column === 'market_id' || column === 'default_market_id') return 'market'
  if (
    (table === 'group_pages' && column === 'page_id') ||
    (table === 'cluster_pages' && column === 'page_id') ||
    (table === 'clusters' && column === 'pillar_page_id') ||
    (table === 'topic_prompts' && column === 'target_page_id')
  ) {
    return 'page'
  }
  return null
}

type LeftValues = Map<string, Set<string>>
type IdMaps = Record<IdMapKind, Map<string, string>>

function remember(left: LeftValues, info: TableInfo, row: Row): void {
  for (const column of info.columnNames) {
    const value = row[column]
    if (value === null || value === undefined) continue
    const key = `${info.table}.${column}`
    let set = left.get(key)
    if (set === undefined) {
      set = new Set()
      left.set(key, set)
    }
    set.add(String(value))
  }
}

function parentKind(fk: ForeignKey): IdMapKind | undefined {
  return policyFor(fk.table)?.idMap
}

function parentNoun(table: string): string {
  const noun = policyFor(table)?.noun
  return typeof noun === 'string' ? noun : 'page'
}

export interface MergeInput {
  staged: SqliteDatabase
  target: SqliteDatabase
  tallies: ImportTallies
  /** The file's key and count context (built from the staged rows). */
  context: RowContext
  /** Tables the file had rows for: a default row a migration added is not merged. */
  fileTables: ReadonlySet<string>
  /** The file has no product catalog: its competitor list is counted one by one. */
  countFlatCompetitors: boolean
}

export function mergeProject(input: MergeInput): void {
  const { staged, target, tallies } = input
  const ordered = catalogTables(staged).filter((info) => input.fileTables.has(info.table))
  const targetInfos = new Map(catalogTables(target).map((info) => [info.table, info]))
  // A row counter another table points at is a real id; one nothing points at is renumbered.
  const referenced = new Set(ordered.flatMap((info) => info.foreignKeys.map((fk) => fk.table)))
  const targetContext = rowContext({
    prompt_sets: selectAll(target, 'prompt_sets'),
    prompt_variants: selectAll(target, 'prompt_variants')
  })
  const maps: IdMaps = {
    market: new Map(),
    page: new Map(),
    product: new Map(),
    group: new Map(),
    cluster: new Map()
  }
  const skipped: LeftValues = new Map()
  const failed: LeftValues = new Map()
  target.transaction(() => {
    for (const info of ordered) {
      const policy = policyFor(info.table)
      const targetInfo = targetInfos.get(info.table)
      if (policy === undefined || targetInfo === undefined) continue
      const rows = selectAll(staged, info.table)
      if (policy.singleton === true) {
        for (const row of rows) {
          mergeSingleton(target, targetInfo, policy, row, tallies, input.countFlatCompetitors)
        }
        continue
      }
      mergeRows({
        target,
        renumber: targetInfo.rowCounter !== null && !referenced.has(info.table),
        info,
        targetInfo,
        policy,
        rows,
        tallies,
        context: input.context,
        targetContext,
        maps,
        skipped,
        failed
      })
    }
  })()
}

function mergeSingleton(
  target: SqliteDatabase,
  info: TableInfo,
  policy: TablePolicy,
  row: Row,
  tallies: ImportTallies,
  countFlat: boolean
): void {
  const current =
    target.prepare<unknown[], Row>(`SELECT * FROM ${quoteName(info.table)} WHERE id = 1`).get() ??
    null
  let next: Row = { ...row }
  if (info.table === 'project_settings') next = mergeSettingsLists(row, current, tallies, countFlat)
  if (current !== null) {
    for (const column of [
      ...Object.keys(policy.local ?? {}),
      ...Object.keys(policy.onImport ?? {}),
      ...(KEEP_ON_REPLACE[info.table] ?? [])
    ]) {
      if (column in current) next[column] = current[column] ?? null
    }
  }
  const columns = Object.keys(next).filter((column) => info.columnNames.has(column))
  try {
    target
      .prepare(insertSql(info.table, columns, true))
      .run(columns.map((column) => next[column] ?? null))
    tallies.added('settings')
  } catch (error) {
    tallies.left('settings', 'failed', nounOf(policy, row), failureReason(error), true)
  }
}

interface MergeRows {
  target: SqliteDatabase
  /** Leave the row counter out: the target numbers new rows itself. */
  renumber: boolean
  info: TableInfo
  targetInfo: TableInfo
  policy: TablePolicy
  rows: readonly Row[]
  tallies: ImportTallies
  context: RowContext
  targetContext: RowContext
  maps: IdMaps
  skipped: LeftValues
  failed: LeftValues
}

function mergeRows(state: MergeRows): void {
  const { target, info, targetInfo, policy, tallies, maps } = state
  const existing = selectAll(target, info.table)
  const identities = new Set(existing.map((row) => rowIdentity(targetInfo, row)))
  const keys = new Map<string, Row>()
  if (policy.key !== undefined) {
    for (const row of existing) {
      const key = policy.key(row, state.targetContext)
      if (key !== null && !keys.has(key)) keys.set(key, row)
    }
  }
  for (const original of state.rows) {
    const section = sectionOf(policy, original)
    const noun = nounOf(policy, original)
    const counted = policy.counts?.(original, state.context) ?? false
    const owner = ownerLeft(info, original, state)
    if (owner !== null) {
      const set = owner.outcome === 'skipped' ? state.skipped : state.failed
      remember(set, info, original)
      tallies.left(section, owner.outcome, noun, owner.reason, counted)
      continue
    }
    const row = remap(info, original, maps)
    if (info.table === 'markets') row.is_default = 0
    const key = policy.key?.(row, state.context) ?? null
    const match = key !== null ? keys.get(key) : undefined
    const sameId = !state.renumber && identities.has(rowIdentity(targetInfo, row))
    if (match !== undefined || sameId) {
      if (policy.idMap !== undefined && typeof original.id === 'string') {
        maps[policy.idMap].set(original.id, String(match?.id ?? row.id))
      }
      remember(state.skipped, info, original)
      tallies.left(section, 'skipped', noun, 'already in the project', counted)
      continue
    }
    const columns = Object.keys(row).filter(
      (column) =>
        targetInfo.columnNames.has(column) && !(state.renumber && column === targetInfo.rowCounter)
    )
    try {
      target
        .prepare(insertSql(info.table, columns))
        .run(columns.map((column) => row[column] ?? null))
      identities.add(rowIdentity(targetInfo, row))
      if (key !== null) keys.set(key, row)
      if (counted) tallies.added(section)
    } catch (error) {
      remember(state.failed, info, original)
      tallies.left(section, 'failed', noun, failureReason(error), counted)
    }
  }
}

/** A row whose owner (its page, question, set…) was skipped or not added goes with it. */
function ownerLeft(
  info: TableInfo,
  row: Row,
  state: Pick<MergeRows, 'skipped' | 'failed' | 'maps'>
): { outcome: 'skipped' | 'failed'; reason: string } | null {
  for (const fk of info.foreignKeys) {
    const value = row[fk.from]
    if (value === null || value === undefined) continue
    const kind = parentKind(fk)
    const parent = `${fk.table}.${fk.to}`
    if (state.failed.get(parent)?.has(String(value))) {
      return { outcome: 'failed', reason: `its ${parentNoun(fk.table)} was not added` }
    }
    const follows = kind !== undefined && FOLLOW.has(kind)
    if (
      !follows &&
      !isReference(info.table, fk.from) &&
      state.skipped.get(parent)?.has(String(value))
    ) {
      return { outcome: 'skipped', reason: `its ${parentNoun(fk.table)} is already in the project` }
    }
  }
  return null
}

function isReference(table: string, column: string): boolean {
  return extraMap(table, column) !== null
}

function remap(info: TableInfo, row: Row, maps: IdMaps): Row {
  const next: Row = { ...row }
  for (const fk of info.foreignKeys) {
    const kind = parentKind(fk)
    const value = next[fk.from]
    if (kind === undefined || value === null || value === undefined) continue
    next[fk.from] = maps[kind].get(String(value)) ?? value
  }
  for (const column of info.columnNames) {
    const kind = extraMap(info.table, column)
    const value = next[column]
    if (kind === null || value === null || value === undefined) continue
    next[column] = maps[kind].get(String(value)) ?? value
  }
  return next
}
