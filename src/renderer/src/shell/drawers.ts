import { useSyncExternalStore } from 'react'
import {
  drawerStack,
  sameStack,
  screenHash,
  usesLegacyDialog,
  withDrawerOpened,
  withDrawerParams,
  withDrawersClosed,
  withDrawerStack,
  type DrawerEntry,
  type DrawerId,
  type DrawerParamPatch
} from './drawerUrl'
import { isReplacingHash, navigateHash, replaceHash } from './routes'

/**
 * The drawer stack and its history (Docs/DRAWER.md). Drawers live on the URL
 * (shell/drawerUrl), so a copied link reopens them; this store adds what a URL
 * alone cannot:
 *
 * - **Back closes the top drawer.** Opening a drawer is a new history entry.
 *   Each entry remembers, per open drawer, how many entries back the screen
 *   without it is (`history.state.citefoxDrawers`). Closing goes back that
 *   many entries instead of writing a new one, so no dead Back step is left
 *   behind (deep audit §1f.5). A drawer opened from a pasted link has no
 *   entries to go back to; closing rewrites the URL in place instead.
 * - **Unsaved changes survive Back.** A drawer that registers a dirty guard
 *   and is closed by Back (or Forward, or a link) is put back, and its guard
 *   asks "Discard changes?" first.
 * - **Results.** A drawer opened from a drawer can hand a value back to the
 *   one under it when it closes (a new topic's id).
 */

const STATE_KEY = 'citefoxDrawers'
/** How long a close waits for its history step before rewriting the URL instead. */
const CLOSE_FALLBACK_MS = 600

interface EntryMark {
  /** Unique per history entry, so a new entry is told apart from one we saw before. */
  key: string
  /** Per open drawer (bottom first): history entries since it opened. 0 = unknown (a pasted link). */
  back: number[]
}

export interface DrawerSnapshot {
  hash: string
  stack: readonly DrawerEntry[]
}

/** What a drawer registers so Back and the router ask before throwing changes away. */
export interface DrawerGuard {
  dirty: boolean
  /** Shows "Discard changes?"; the drawer closes itself on Discard. */
  ask: () => void
}

type Listener = () => void

let snapshot: DrawerSnapshot | null = null
let mark: EntryMark = { key: '', back: [] }
/** The drawers of the history entry `mark` belongs to (the UI may lag behind while restoring). */
let markStack: readonly DrawerEntry[] = []
let installed = false
let keySeed = 0
let restoring: string | null = null
/** A close waiting for its history step to `landing`. */
let closing: { timer: ReturnType<typeof setTimeout> | null; landing: string } | null = null
let afterClose: { depth: number; run: () => void } | null = null
/** An open asked for while a close's history step is on its way: it runs once the step lands. */
let pendingOpen: (() => void) | null = null
const listeners = new Set<Listener>()
const guards = new Map<number, DrawerGuard>()
const resultHandlers = new Map<number, (value: unknown) => void>()

function newKey(): string {
  keySeed += 1
  return `${Date.now().toString(36)}.${keySeed}`
}

function readMark(): EntryMark | null {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null) return null
  const value = (state as Record<string, unknown>)[STATE_KEY]
  if (typeof value !== 'object' || value === null) return null
  const { key, back } = value as { key?: unknown; back?: unknown }
  if (typeof key !== 'string' || !Array.isArray(back)) return null
  return { key, back: back.map((item) => (typeof item === 'number' && item > 0 ? item : 0)) }
}

function writeMark(next: EntryMark): void {
  const state: unknown = window.history.state
  const base = typeof state === 'object' && state !== null ? state : {}
  window.history.replaceState({ ...base, [STATE_KEY]: next }, '')
  mark = next
}

/** Back counts after a new history entry: kept drawers count one more, new ones start at 1. */
function pushedBack(
  before: readonly number[],
  from: readonly DrawerEntry[],
  to: readonly DrawerEntry[]
): number[] {
  return to.map((entry, depth) => {
    const kept =
      from[depth]?.id === entry.id &&
      from.slice(0, depth).every((item, index) => item.id === to[index]?.id)
    if (!kept) return 1
    const count = before[depth] ?? 0
    return count > 0 ? count + 1 : 0
  })
}

/** Back counts after the current entry was rewritten: kept drawers keep theirs, new ones are unknown. */
function replacedBack(
  before: readonly number[],
  from: readonly DrawerEntry[],
  to: readonly DrawerEntry[]
): number[] {
  return to.map((entry, depth) => (from[depth]?.id === entry.id ? (before[depth] ?? 0) : 0))
}

function emit(): void {
  for (const listener of listeners) listener()
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

function install(): DrawerSnapshot {
  if (installed && snapshot) return snapshot
  installed = true
  const hash = currentHash()
  snapshot = { hash, stack: drawerStack(hash) }
  const seen = readMark()
  if (seen && seen.back.length === snapshot.stack.length) mark = seen
  else writeMark({ key: newKey(), back: snapshot.stack.map(() => 0) })
  markStack = snapshot.stack
  window.addEventListener('hashchange', onHashChange)
  // Not during the render that installed the store: the rewrite tells listeners.
  queueMicrotask(canonicalize)
  return snapshot
}

/** Old `?dialog=add-questions` links become `drawer=add-questions` in place. */
function canonicalize(): void {
  const hash = currentHash()
  if (usesLegacyDialog(hash)) replaceHash(withDrawerStack(hash, drawerStack(hash)))
}

/** The first depth whose drawer is gone or different in `to`. */
function firstChanged(from: readonly DrawerEntry[], to: readonly DrawerEntry[]): number {
  let depth = 0
  while (depth < from.length && from[depth]?.id === to[depth]?.id) depth += 1
  return depth
}

function onHashChange(): void {
  const before = snapshot ?? install()
  const hash = currentHash()
  const replacing = isReplacingHash()
  // Nothing new, unless it is the history step a close is waiting for (the UI
  // already shows its result) or a rewrite after one.
  if (hash === before.hash && restoring === null && closing === null && !replacing) return
  const stack = drawerStack(hash)
  const seen = readMark()
  const ours = closing !== null || restoring !== null

  if (replacing) {
    writeMark({ key: seen?.key ?? newKey(), back: replacedBack(mark.back, markStack, stack) })
  } else if (seen === null || seen.key === mark.key) {
    // A new history entry (a link, navigateHash). Some engines copy the old
    // entry's state into a new one, so the same key also means "new". A link
    // to another screen with a drawer on it: the entry before is a different
    // screen, so closing rewrites the URL to this screen instead of going back.
    const sameScreen = screenHash(before.hash) === screenHash(hash)
    writeMark({
      key: newKey(),
      back: sameScreen ? pushedBack(mark.back, markStack, stack) : stack.map(() => 0)
    })
  } else {
    // Back or Forward to an entry seen before: it keeps its own counts.
    mark = seen.back.length === stack.length ? seen : { key: seen.key, back: stack.map(() => 0) }
  }
  markStack = stack

  if (!replacing && !ours) {
    const from = firstChanged(before.stack, stack)
    for (let depth = before.stack.length - 1; depth >= from; depth -= 1) {
      const guard = guards.get(depth)
      if (guard?.dirty) {
        // Put the drawer back, then ask. Discard closes it through closeDrawer.
        restoring = before.hash
        navigateHash(before.hash)
        guard.ask()
        return
      }
    }
  }

  if (restoring !== null && hash === restoring) restoring = null
  if (closing) {
    if (closing.timer) clearTimeout(closing.timer)
    closing = null
  }
  for (const depth of [...resultHandlers.keys()]) {
    if (depth >= stack.length && afterClose?.depth !== depth) resultHandlers.delete(depth)
  }
  if (!sameStack(before.stack, stack) || before.hash !== hash) {
    snapshot = { hash, stack }
    emit()
  }
  if (afterClose && stack.length <= afterClose.depth) {
    const { run } = afterClose
    afterClose = null
    run()
  }
  runPendingOpen()
  canonicalize()
}

function runPendingOpen(): void {
  if (closing !== null || pendingOpen === null) return
  const run = pendingOpen
  pendingOpen = null
  run()
}

/**
 * A new history entry for `hash`, taken in now rather than when its
 * hashchange event arrives: a render in between (the opener's own state)
 * would otherwise read the new hash first and count it as a rewrite, and the
 * drawer would lose the Back step it closes with. The late event finds
 * nothing new.
 */
function pushHash(hash: string): void {
  navigateHash(hash)
  onHashChange()
}

function subscribe(listener: Listener): () => void {
  install()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): DrawerSnapshot {
  const current = install()
  const hash = currentHash()
  if (hash !== current.hash && restoring === null && closing === null) {
    // The hash changed and its event has not come yet: a link was followed
    // (a new entry, whose state starts empty) or the URL was rewritten in
    // place (history.replaceState keeps the entry's state). The late event
    // then finds nothing new. Back or Forward to an entry seen before is left
    // to its event, which puts a dirty drawer back and asks first.
    const seen = readMark()
    if (seen !== null && seen.key !== mark.key) return current
    const stack = drawerStack(hash)
    snapshot = sameStack(current.stack, stack) ? { hash, stack: current.stack } : { hash, stack }
    if (seen === null) {
      const sameScreen = screenHash(current.hash) === screenHash(hash)
      writeMark({
        key: newKey(),
        back: sameScreen ? pushedBack(mark.back, markStack, stack) : stack.map(() => 0)
      })
    } else {
      mark = { key: mark.key, back: replacedBack(mark.back, markStack, stack) }
    }
    markStack = stack
    if (usesLegacyDialog(hash)) queueMicrotask(canonicalize)
  }
  return snapshot ?? current
}

const SERVER: DrawerSnapshot = { hash: '', stack: [] }

function getServerSnapshot(): DrawerSnapshot {
  return SERVER
}

/** The open drawers right now, bottom first. */
export function currentDrawers(): readonly DrawerEntry[] {
  return getSnapshot().stack
}

export interface OpenDrawerOptions {
  /** Called with the value the drawer closes with (`closeDrawer(depth, value)`). */
  onResult?: (value: unknown) => void
  /** Rewrite the current entry instead of adding one (Back then skips the drawer). */
  replace?: boolean
}

/** The link that opens drawer `id` over `hash` (default: the current URL). */
export function drawerHref(
  id: DrawerId,
  values: DrawerParamPatch = {},
  hash: string = currentHash()
): string {
  return withDrawerOpened(hash, id, values)
}

/** Opens drawer `id` with its values: over the open one, or alone. */
export function openDrawer(
  id: DrawerId,
  values: DrawerParamPatch = {},
  options: OpenDrawerOptions = {}
): void {
  const shown = install()
  // While a close steps back through history, open over where it lands, show
  // that now, and write the entry once the step is in (else the step would
  // undo the open).
  const from = closing !== null ? (snapshot ?? shown).hash : currentHash()
  const next = withDrawerOpened(from, id, values)
  const depth = drawerStack(next).findIndex((entry) => entry.id === id)
  const write = (): void => {
    if (options.onResult) resultHandlers.set(depth, options.onResult)
    else resultHandlers.delete(depth)
    if (options.replace) replaceHash(next)
    else pushHash(next)
  }
  if (closing === null) {
    write()
    return
  }
  pendingOpen = write
  snapshot = { hash: next, stack: drawerStack(next) }
  emit()
}

/** Whether the drawer at `depth` was opened by a picker waiting for its result. */
export function hasDrawerResult(depth: number): boolean {
  return resultHandlers.has(depth)
}

/** Rewrites the values of the drawer at `depth` (a tab, a step, a filter). */
export function setDrawerParams(
  depth: number,
  patch: DrawerParamPatch,
  options: { push?: boolean } = {}
): void {
  install()
  const next = withDrawerParams(currentHash(), depth, patch)
  if (next === currentHash()) return
  if (options.push) pushHash(next)
  else replaceHash(next)
}

/**
 * Goes `steps` entries back to `landing`, showing it at once: the history
 * step is a task away, and a drawer that lingers after ✕ or Escape feels
 * broken. The step's hashchange then takes in that entry's own marks.
 */
function goBackTo(steps: number, landing: string, fallback: string = landing): void {
  startClosing(fallback, landing)
  window.history.go(-steps)
  const stack = drawerStack(landing)
  snapshot = { hash: landing, stack }
  emit()
}

function startClosing(fallback: string, landing: string): void {
  const state: NonNullable<typeof closing> = { timer: null, landing }
  closing = state
  state.timer = setTimeout(() => {
    if (closing !== state) return
    closing = null
    // The history step never came (nothing to go back to): rewrite instead.
    if (currentHash() !== fallback) replaceHash(fallback)
    runPendingOpen()
  }, CLOSE_FALLBACK_MS)
}

/**
 * Closes the drawer at `depth` and every drawer over it (default: the top
 * one). Goes back through history when the drawer was opened in this
 * session, so Back never lands on it again; otherwise rewrites the URL.
 * `result` goes to the `onResult` of the drawer's `openDrawer` call.
 */
export function closeDrawer(depth?: number, result?: unknown): void {
  const { stack, hash } = getSnapshot()
  if (stack.length === 0) return
  const at = Math.max(0, Math.min(depth ?? stack.length - 1, stack.length - 1))
  if (closing !== null) {
    // Only a drawer opened while the close is under way can be closed now: it
    // is not on history yet, so dropping it is enough.
    if (pendingOpen === null) return
    const target = withDrawersClosed(hash, at)
    pendingOpen = target === closing.landing ? null : () => replaceHash(target)
    snapshot = { hash: target, stack: drawerStack(target) }
    emit()
    return
  }
  const handler = resultHandlers.get(at)
  resultHandlers.delete(at)
  if (handler && result !== undefined) {
    afterClose = { depth: at, run: () => handler(result) }
  }
  const fallback = withDrawersClosed(hash, at)
  const steps = mark.back[at] ?? 0
  const known = mark.back.slice(at).every((count) => count > 0)
  if (steps > 0 && known && mark.back.length === stack.length) {
    goBackTo(steps, fallback)
    return
  }
  replaceHash(fallback)
  if (afterClose && afterClose.depth === at) {
    const { run } = afterClose
    afterClose = null
    run()
  }
}

/** Closes every drawer. */
export function closeAllDrawers(): void {
  closeDrawer(0)
}

/**
 * Closes every drawer, then opens `hash` (a breadcrumb, "Open the topic"):
 * the drawers leave history as if Back was pressed, and `hash` is a new entry.
 */
export function closeDrawersThen(hash: string): void {
  const { stack } = getSnapshot()
  if (stack.length === 0) {
    navigateHash(hash)
    return
  }
  const steps = mark.back[0] ?? 0
  if (steps > 0 && mark.back.every((count) => count > 0) && closing === null) {
    afterClose = { depth: 0, run: () => navigateHash(hash) }
    // Should the step never come, the link replaces the drawer's entry.
    goBackTo(steps, withDrawersClosed(getSnapshot().hash, 0), hash)
    return
  }
  replaceHash(hash)
}

/** Registers the dirty guard of the drawer at `depth`. Returns the unregister call. */
export function registerDrawerGuard(depth: number, guard: DrawerGuard): () => void {
  guards.set(depth, guard)
  return () => {
    if (guards.get(depth) === guard) guards.delete(depth)
  }
}

export interface DrawerStackApi {
  stack: readonly DrawerEntry[]
  /** The URL the stack was read from. */
  hash: string
  open: typeof openDrawer
  close: typeof closeDrawer
  closeAll: typeof closeAllDrawers
  closeThen: typeof closeDrawersThen
  setParams: typeof setDrawerParams
}

/** The open drawers, following the URL, with the calls that open and close them. */
export function useDrawerStack(): DrawerStackApi {
  const { stack, hash } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return {
    stack,
    hash,
    open: openDrawer,
    close: closeDrawer,
    closeAll: closeAllDrawers,
    closeThen: closeDrawersThen,
    setParams: setDrawerParams
  }
}

/** One open drawer of a kind: its values, its depth, and the calls a screen needs. */
export interface DrawerEntryApi {
  entry: DrawerEntry
  depth: number
  /** Closes this drawer (and any over it), handing `result` to its opener. */
  close: (result?: unknown) => void
  /** Rewrites this drawer's values (a tab, a mode). */
  setParams: (patch: DrawerParamPatch, options?: { push?: boolean }) => void
}

/**
 * The open drawer of kind `id`, or null. For a screen-owned drawer
 * (Docs/DRAWER.md "Adding a drawer"): render it inside
 * `<DrawerLevel depth={api.depth}>`.
 */
export function useDrawerEntry(id: DrawerId): DrawerEntryApi | null {
  const { stack } = useDrawerStack()
  const depth = stack.findIndex((entry) => entry.id === id)
  const entry = depth >= 0 ? stack[depth] : undefined
  if (entry === undefined) return null
  return {
    entry,
    depth,
    close: (result) => closeDrawer(depth, result),
    setParams: (patch, options) => setDrawerParams(depth, patch, options)
  }
}

/** Tests only: forget the store so the next use starts from the current URL. */
export function resetDrawersForTests(): void {
  if (installed) window.removeEventListener('hashchange', onHashChange)
  if (closing?.timer) clearTimeout(closing.timer)
  installed = false
  snapshot = null
  mark = { key: '', back: [] }
  markStack = []
  restoring = null
  closing = null
  afterClose = null
  pendingOpen = null
  guards.clear()
  resultHandlers.clear()
  listeners.clear()
}
