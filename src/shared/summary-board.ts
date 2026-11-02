/**
 * The Summary board (owner-approved mock-up, 2026-10-30, "A Summary you arrange, like your
 * iPhone's Home Screen"): an ordered list of widgets, each with a size, its own engine
 * filter and what it is about. Kept per project (`summary:getBoard` / `summary:setBoard`).
 * Pure: main validates a saved board with {@link normalizeBoard}; the renderer edits it.
 */

import { isEngineId, type EngineId } from './domain/engines'

export const BOARD_VERSION = 1

/** Widgets on one board at most. */
export const MAX_WIDGETS = 24

export const WIDGET_KINDS = [
  'headline',
  'results',
  'trend',
  'cited-sites',
  'next-fixes',
  'changes',
  'cited-rate',
  'fixes-working',
  'engines',
  'competitor',
  'google-updates',
  'credits',
  'page-changes',
  'question'
] as const

export type WidgetKind = (typeof WIDGET_KINDS)[number]

/** Small: 1 of 4 columns. Medium: 2. Large: 2 columns, 2 rows tall. Wide: all 4. */
export const WIDGET_SIZES = ['s', 'm', 'l', 'w'] as const

export type WidgetSize = (typeof WIDGET_SIZES)[number]

/** `all`, or one engine. */
export type WidgetEngine = 'all' | EngineId

export const ROLE_PRESETS = ['executive', 'publisher', 'auditor'] as const

export type RolePreset = (typeof ROLE_PRESETS)[number]

/** What a trend widget follows: the project, one topic or one tracked page. */
export interface WidgetScope {
  kind: 'project' | 'topic' | 'page'
  /** The topic or page id. Absent for the project. */
  id?: string
}

/** What a widget is about, when it is about one thing. */
export interface WidgetConfig {
  scope?: WidgetScope
  /** A competitor's site, for Competitor watch. */
  domain?: string
  /** A pinned question: its page (or topic) and prompt. */
  pageId?: string
  promptId?: string
  /** The thing's name when it was pinned ("Pricing page", "zapier.com"). */
  label?: string
}

export interface BoardWidget {
  /** Unique on the board. */
  id: string
  kind: WidgetKind
  size: WidgetSize
  engine: WidgetEngine
  config: WidgetConfig
}

export interface SummaryBoard {
  version: typeof BOARD_VERSION
  /** The role preset the board started from, if any. */
  preset: RolePreset | null
  widgets: readonly BoardWidget[]
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/
const THING_ID = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,119}$/
const DOMAIN = /^[a-z0-9][a-z0-9.-]{0,252}$/i
const LABEL_MAX = 160

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

export function isWidgetKind(value: unknown): value is WidgetKind {
  return isOneOf(WIDGET_KINDS, value)
}

export function isWidgetSize(value: unknown): value is WidgetSize {
  return isOneOf(WIDGET_SIZES, value)
}

export function isRolePreset(value: unknown): value is RolePreset {
  return isOneOf(ROLE_PRESETS, value)
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeScope(value: unknown): WidgetScope | undefined {
  const raw = record(value)
  if (raw === null) return undefined
  if (raw.kind === 'project') return { kind: 'project' }
  if ((raw.kind === 'topic' || raw.kind === 'page') && typeof raw.id === 'string') {
    return THING_ID.test(raw.id) ? { kind: raw.kind, id: raw.id } : undefined
  }
  return undefined
}

function normalizeConfig(value: unknown): WidgetConfig {
  const raw = record(value)
  if (raw === null) return {}
  const out: WidgetConfig = {}
  const scope = normalizeScope(raw.scope)
  if (scope !== undefined) out.scope = scope
  if (typeof raw.domain === 'string' && DOMAIN.test(raw.domain)) {
    out.domain = raw.domain.toLowerCase()
  }
  if (typeof raw.pageId === 'string' && THING_ID.test(raw.pageId)) out.pageId = raw.pageId
  if (typeof raw.promptId === 'string' && THING_ID.test(raw.promptId)) out.promptId = raw.promptId
  if (typeof raw.label === 'string') {
    const label = raw.label.trim().slice(0, LABEL_MAX)
    if (label.length > 0) out.label = label
  }
  return out
}

/** One widget, or null when it does not parse. */
export function normalizeWidget(value: unknown): BoardWidget | null {
  const raw = record(value)
  if (raw === null) return null
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return null
  if (!isWidgetKind(raw.kind) || !isWidgetSize(raw.size)) return null
  const engine: WidgetEngine = raw.engine === 'all' || isEngineId(raw.engine) ? raw.engine : 'all'
  return { id: raw.id, kind: raw.kind, size: raw.size, engine, config: normalizeConfig(raw.config) }
}

/**
 * A board from stored or sent JSON: unknown widgets are dropped, ids stay unique and the
 * list stops at {@link MAX_WIDGETS}. Null when it is not a board at all.
 */
export function normalizeBoard(value: unknown): SummaryBoard | null {
  const raw = record(value)
  if (raw === null || raw.version !== BOARD_VERSION || !Array.isArray(raw.widgets)) return null
  const seen = new Set<string>()
  const widgets: BoardWidget[] = []
  for (const item of raw.widgets) {
    const widget = normalizeWidget(item)
    if (widget === null || seen.has(widget.id)) continue
    seen.add(widget.id)
    widgets.push(widget)
    if (widgets.length === MAX_WIDGETS) break
  }
  return {
    version: BOARD_VERSION,
    preset: isRolePreset(raw.preset) ? raw.preset : null,
    widgets
  }
}
