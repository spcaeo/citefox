import {
  AI_CONTEXT_LIMITS,
  type AiContext,
  type AiContextBase,
  type AiContextPatch,
  type AiEntityRef,
  type AiNumber
} from './types'

/**
 * The context registry. The shell sets the route part (`setAiBase`); screens,
 * drawers and KPI tiles register patches while they are mounted. Patches
 * merge by layer: the screen (0) under a drawer (1) under a stacked drawer
 * (2); within a layer, in the order they registered. A later scalar wins;
 * lists add up (numbers by label, entities by kind + label). Nothing here
 * renders: only the Ask drawer and the ✦ menus read it.
 */

interface Registered {
  layer: number
  order: number
  patch: AiContextPatch
}

type Listener = () => void

let base: AiContextBase | null = null
let seed = 0
const patches = new Map<number, Registered>()
const listeners = new Set<Listener>()
let cached: AiContext | null = null

function changed(): void {
  cached = null
  for (const listener of [...listeners]) listener()
}

export function subscribeAiContext(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The shell's route part. Null when the shell is not mounted (tests of one component). */
export function setAiBase(next: AiContextBase | null): void {
  if (sameJson(base, next)) return
  base = next
  changed()
}

export function aiBase(): AiContextBase | null {
  return base
}

/** Registers a patch; returns its token for updates and removal. */
export function registerAiPatch(layer: number, patch: AiContextPatch): number {
  seed += 1
  patches.set(seed, { layer, order: seed, patch })
  changed()
  return seed
}

export function updateAiPatch(token: number, layer: number, patch: AiContextPatch): void {
  const current = patches.get(token)
  if (!current) return
  if (current.layer === layer && sameJson(current.patch, patch)) return
  patches.set(token, { ...current, layer, patch })
  changed()
}

export function removeAiPatch(token: number): void {
  if (patches.delete(token)) changed()
}

/** Tests only: forget every patch and the base. */
export function resetAiContext(): void {
  base = null
  patches.clear()
  changed()
}

const EMPTY_BASE: AiContextBase = {
  screen: 'none',
  screenLabel: 'CiteFox',
  route: '#/',
  crumbs: [],
  projectId: null,
  projectName: null,
  pageId: null,
  topicId: null,
  promptId: null,
  marketId: null,
  runId: null,
  filters: {}
}

/** The merged context. The same object until something changes. */
export function currentAiContext(): AiContext {
  if (cached) return cached
  cached = mergeAiContext(base ?? EMPTY_BASE, [...patches.values()])
  return cached
}

/** Pure merge, exported for tests. */
export function mergeAiContext(start: AiContextBase, registered: readonly Registered[]): AiContext {
  const ordered = [...registered].sort((a, b) => a.layer - b.layer || a.order - b.order)
  const out: AiContext = {
    ...start,
    entities: [],
    selection: [],
    numbers: [],
    facts: [],
    capabilities: []
  }
  const entities = new Map<string, AiEntityRef>()
  const selection = new Map<string, AiEntityRef>()
  const numbers = new Map<string, AiNumber>()
  const facts = new Set<string>()
  const capabilities = new Set<AiContext['capabilities'][number]>()
  let filters: Record<string, string> = { ...start.filters }
  for (const { patch } of ordered) {
    if (patch.screen) out.screen = patch.screen
    if (patch.screenLabel) out.screenLabel = clip(patch.screenLabel)
    for (const key of ['pageId', 'topicId', 'promptId', 'marketId', 'runId'] as const) {
      const value = patch[key]
      if (value !== undefined) out[key] = value
    }
    for (const item of patch.entities ?? []) entities.set(entityKey(item), cleanEntity(item))
    // A later layer's selection replaces the one under it (a drawer's picks win).
    if (patch.selection !== undefined) {
      selection.clear()
      for (const item of patch.selection) selection.set(entityKey(item), cleanEntity(item))
    }
    for (const item of patch.numbers ?? []) {
      numbers.set(item.label, { ...item, label: clip(item.label), value: clip(item.value) })
    }
    for (const fact of patch.facts ?? []) facts.add(clip(fact))
    for (const action of patch.capabilities ?? []) capabilities.add(action)
    if (patch.filters) filters = { ...filters, ...patch.filters }
  }
  out.entities = [...entities.values()]
    .map((item) => withCrumbName(item, out, start.pageName ?? null))
    .slice(0, AI_CONTEXT_LIMITS.entities)
  out.selection = [...selection.values()].slice(0, AI_CONTEXT_LIMITS.entities)
  out.numbers = [...numbers.values()].slice(0, AI_CONTEXT_LIMITS.numbers)
  out.facts = [...facts].slice(0, AI_CONTEXT_LIMITS.facts)
  out.capabilities = [...capabilities]
  out.filters = Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => [key, clip(value)])
  )
  return out
}

/**
 * The open page or topic named as the breadcrumb names it. Screens name the
 * page in different ways (its short label, its title, its URL); the
 * breadcrumb's words win for the page or topic the route opens.
 */
function withCrumbName(item: AiEntityRef, context: AiContext, name: string | null): AiEntityRef {
  if (name === null || name.trim() === '' || !item.id) return item
  const open =
    (item.kind === 'page' && item.id === context.pageId) ||
    (item.kind === 'topic' && item.id === context.topicId) ||
    (item.kind === 'page' && item.id === context.topicId)
  return open ? { ...item, label: clip(name) } : item
}

function entityKey(item: AiEntityRef): string {
  return `${item.kind}:${item.id ?? item.label}`
}

function cleanEntity(item: AiEntityRef): AiEntityRef {
  return {
    kind: item.kind,
    ...(item.id ? { id: item.id } : {}),
    label: clip(item.label),
    ...(item.detail ? { detail: clip(item.detail) } : {})
  }
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > AI_CONTEXT_LIMITS.text
    ? `${flat.slice(0, AI_CONTEXT_LIMITS.text - 1)}…`
    : flat
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
