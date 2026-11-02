import type { SetupItem, SetupRow } from '@shared/ipc'

/**
 * Onboarding v2 section cards: every change to a section's rows, as pure
 * functions over `SetupItem[]` (BRIEF "The section card"). The rules:
 *
 * - ✦ Find more (and a pasted ChatGPT answer) adds fresh rows on top, marked
 *   "new". Nothing already there changes.
 * - ✦ Redo replaces the AI rows the user has not touched. Their own rows,
 *   the rows they edited, and the ticks of rows that come back again stay.
 * - Any other action (tick, edit, remove, add) clears the "new" marks.
 */

export type MakeId = () => string

let counter = 0

/** An opaque id, unique within a draft (never a name, a domain or an email). */
export function makeItemId(): string {
  counter += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `it${Date.now().toString(36)}${counter.toString(36)}${random}`
}

/** Case, spacing and punctuation folded, so "Text Bolt" and "text-bolt" match. */
export function rowKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/^www\./u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** True for a row the user owns: typed by them, or an AI row they edited. AI never replaces it. */
export function isUserOwned(item: SetupItem): boolean {
  return item.origin === 'user' || item.edited
}

function aiItem(row: SetupRow, makeId: MakeId, fresh: boolean): SetupItem {
  return {
    name: row.name.trim(),
    detail: row.detail.trim(),
    url: row.url,
    tag: row.tag,
    ...(row.tier !== undefined ? { tier: row.tier } : {}),
    id: makeId(),
    origin: 'ai',
    kept: true,
    edited: false,
    fresh
  }
}

/** Rows as new AI items, ticked (step 3's read, a first fill). */
export function itemsFromRows(rows: readonly SetupRow[], makeId: MakeId = makeItemId): SetupItem[] {
  return dedupeRows(rows, new Set()).map((row) => aiItem(row, makeId, false))
}

/** Drops empty rows and rows whose name is in `taken` or repeats an earlier row. */
function dedupeRows(rows: readonly SetupRow[], taken: ReadonlySet<string>): SetupRow[] {
  const seen = new Set(taken)
  const out: SetupRow[] = []
  for (const row of rows) {
    const key = rowKey(row.name)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** The "new" marks gone: the next action in a section clears them. */
export function clearFresh(items: readonly SetupItem[]): SetupItem[] {
  return items.some((item) => item.fresh)
    ? items.map((item) => (item.fresh ? { ...item, fresh: false } : item))
    : [...items]
}

export interface MergeResult {
  items: SetupItem[]
  /** Rows that were added (Find more) or arrived as replacements (Redo). */
  added: number
}

/**
 * ✦ Find more, or an answer pasted from the user's own ChatGPT: new rows go on
 * top, ticked and marked fresh; a row already in the list (by name) is skipped.
 * Older "new" marks clear.
 */
export function applyMore(
  items: readonly SetupItem[],
  rows: readonly SetupRow[],
  makeId: MakeId = makeItemId
): MergeResult {
  const taken = new Set(items.map((item) => rowKey(item.name)))
  const fresh = dedupeRows(rows, taken).map((row) => aiItem(row, makeId, true))
  return { items: [...fresh, ...clearFresh(items)], added: fresh.length }
}

/**
 * ✦ Redo (or Run again with an edited prompt): the AI rows the user has not
 * touched are replaced by `rows`. Rows they own stay where they are, ticks
 * and all. A returned row that matches an untouched AI row keeps that row's
 * id and tick, so a row the user left out stays left out. Replacements come
 * first, in Claude's order, then the user's rows.
 */
export function applyRedo(
  items: readonly SetupItem[],
  rows: readonly SetupRow[],
  makeId: MakeId = makeItemId
): MergeResult {
  const owned = clearFresh(items.filter(isUserOwned))
  const previous = new Map<string, SetupItem>()
  for (const item of items) {
    if (!isUserOwned(item)) previous.set(rowKey(item.name), item)
  }
  const taken = new Set(owned.map((item) => rowKey(item.name)))
  const replacements = dedupeRows(rows, taken).map((row) => {
    const before = previous.get(rowKey(row.name))
    const next = aiItem(row, makeId, false)
    return before ? { ...next, id: before.id, kept: before.kept } : next
  })
  return { items: [...replacements, ...owned], added: replacements.length }
}

/** Ticks or unticks one row. Unticked rows stay visible and are not saved. */
export function toggleItem(items: readonly SetupItem[], id: string): SetupItem[] {
  return clearFresh(items).map((item) => (item.id === id ? { ...item, kept: !item.kept } : item))
}

export type ItemPatch = Partial<Pick<SetupItem, 'name' | 'detail' | 'url' | 'tag' | 'tier'>>

/**
 * Saves an in-place edit. An AI row the user changes becomes theirs
 * (`origin: 'user'`, `edited: true`) and is never replaced. Saving with
 * nothing changed leaves the row as it was.
 */
export function editItem(items: readonly SetupItem[], id: string, patch: ItemPatch): SetupItem[] {
  return clearFresh(items).map((item) => {
    if (item.id !== id) return item
    const next = { ...item, ...patch, name: (patch.name ?? item.name).trim() }
    if (patch.detail !== undefined) next.detail = patch.detail.trim()
    const changed =
      next.name !== item.name ||
      next.detail !== item.detail ||
      next.url !== item.url ||
      next.tag !== item.tag ||
      (next.tier ?? null) !== (item.tier ?? null)
    if (!changed) return item
    return { ...next, origin: 'user', edited: item.origin === 'ai' ? true : item.edited }
  })
}

export interface AddResult {
  items: SetupItem[]
  /** False when the name was empty or already listed. */
  added: boolean
  /** The new row's id, or the id of the row that already has this name. */
  id: string | null
}

/** + Add: the user's own row at the end, ticked, tagged "yours". */
export function addItem(
  items: readonly SetupItem[],
  row: SetupRow,
  makeId: MakeId = makeItemId
): AddResult {
  const key = rowKey(row.name)
  const cleared = clearFresh(items)
  if (key.length === 0) return { items: cleared, added: false, id: null }
  const same = items.find((item) => rowKey(item.name) === key)
  if (same) return { items: cleared, added: false, id: same.id }
  const item: SetupItem = {
    name: row.name.trim(),
    detail: row.detail.trim(),
    url: row.url,
    tag: row.tag,
    ...(row.tier !== undefined ? { tier: row.tier } : {}),
    id: makeId(),
    origin: 'user',
    kept: true,
    edited: false,
    fresh: false
  }
  return { items: [...cleared, item], added: true, id: item.id }
}

export interface Removed {
  item: SetupItem
  index: number
}

/** ✕ Remove. Returns what was removed so Undo can put it back where it was. */
export function removeItem(
  items: readonly SetupItem[],
  id: string
): { items: SetupItem[]; removed: Removed | null } {
  const index = items.findIndex((item) => item.id === id)
  const cleared = clearFresh(items)
  if (index < 0) return { items: cleared, removed: null }
  const item = items[index] as SetupItem
  return {
    items: cleared.filter((entry) => entry.id !== id),
    removed: { item: { ...item, fresh: false }, index }
  }
}

/** Undo for ✕ Remove: the row goes back at its old place (or the end), unless it is back already. */
export function restoreItem(items: readonly SetupItem[], removed: Removed): SetupItem[] {
  if (items.some((item) => item.id === removed.item.id)) return [...items]
  const at = Math.max(0, Math.min(removed.index, items.length))
  return [...items.slice(0, at), removed.item, ...items.slice(at)]
}

/**
 * A comma line ("They switch from: AT&T, Verizon") saved back as a list: names
 * already there keep their item (and origin); new names are the user's own.
 */
export function itemsFromNames(
  items: readonly SetupItem[],
  names: readonly string[],
  makeId: MakeId = makeItemId
): SetupItem[] {
  const byKey = new Map(items.map((item) => [rowKey(item.name), item]))
  const seen = new Set<string>()
  const out: SetupItem[] = []
  for (const raw of names) {
    const name = raw.trim()
    const key = rowKey(name)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    const before = byKey.get(key)
    if (before) {
      out.push({ ...before, kept: true, fresh: false })
      continue
    }
    out.push({
      name,
      detail: '',
      url: null,
      tag: null,
      id: makeId(),
      origin: 'user',
      kept: true,
      edited: false,
      fresh: false
    })
  }
  return out
}

export function keptCount(items: readonly SetupItem[]): number {
  return items.filter((item) => item.kept).length
}

export function freshCount(items: readonly SetupItem[]): number {
  return items.filter((item) => item.fresh).length
}
