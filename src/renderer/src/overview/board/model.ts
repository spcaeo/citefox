import {
  BOARD_VERSION,
  MAX_WIDGETS,
  type BoardWidget,
  type RolePreset,
  type SummaryBoard,
  type WidgetConfig,
  type WidgetEngine,
  type WidgetKind,
  type WidgetSize
} from '@shared/summary-board'
import { WIDGET_INFO } from './catalog'

/**
 * The Summary board as plain data: add, remove (with Undo), resize, reorder, presets.
 * Pure: every function returns a new board and never touches the one given.
 */

export interface WidgetSpec {
  kind: WidgetKind
  size?: WidgetSize
  engine?: WidgetEngine
  config?: WidgetConfig
}

/** A widget taken off the board, and where it stood, so Undo puts it back. */
export interface RemovedWidget {
  widget: BoardWidget
  index: number
}

let counter = 0

/** A board-unique id: time and a counter, so two quick adds never clash. */
export function newWidgetId(now: number = Date.now()): string {
  counter = (counter + 1) % 1_000_000
  return `w-${now.toString(36)}-${counter.toString(36)}`
}

function widgetOf(spec: WidgetSpec, id: string): BoardWidget {
  const info = WIDGET_INFO[spec.kind]
  const size =
    spec.size !== undefined && info.sizes.includes(spec.size) ? spec.size : info.defaultSize
  return {
    id,
    kind: spec.kind,
    size,
    engine: info.engines ? (spec.engine ?? 'all') : 'all',
    config: spec.config ?? {}
  }
}

function boardOf(widgets: readonly BoardWidget[], preset: RolePreset | null): SummaryBoard {
  return { version: BOARD_VERSION, preset, widgets }
}

/** True when another widget fits. */
export function canAdd(board: SummaryBoard): boolean {
  return board.widgets.length < MAX_WIDGETS
}

/** Adds a widget at the end (the board is unchanged when it is full). */
export function addWidget(
  board: SummaryBoard,
  spec: WidgetSpec,
  id: string = newWidgetId()
): SummaryBoard {
  if (!canAdd(board)) return board
  return boardOf([...board.widgets, widgetOf(spec, id)], board.preset)
}

/** Takes a widget off. `removed` is null when the id is not on the board. */
export function removeWidget(
  board: SummaryBoard,
  id: string
): { board: SummaryBoard; removed: RemovedWidget | null } {
  const index = board.widgets.findIndex((widget) => widget.id === id)
  const widget = board.widgets[index]
  if (widget === undefined) return { board, removed: null }
  return {
    board: boardOf(
      board.widgets.filter((item) => item.id !== id),
      board.preset
    ),
    removed: { widget, index }
  }
}

/** Undo for {@link removeWidget}: back where it stood (or last, if the board shrank). */
export function restoreWidget(board: SummaryBoard, removed: RemovedWidget): SummaryBoard {
  if (board.widgets.some((widget) => widget.id === removed.widget.id) || !canAdd(board)) {
    return board
  }
  const widgets = [...board.widgets]
  widgets.splice(Math.min(removed.index, widgets.length), 0, removed.widget)
  return boardOf(widgets, board.preset)
}

/** A new size, when the widget fits it. */
export function resizeWidget(board: SummaryBoard, id: string, size: WidgetSize): SummaryBoard {
  let changed = false
  const widgets = board.widgets.map((widget) => {
    if (widget.id !== id || widget.size === size) return widget
    if (!WIDGET_INFO[widget.kind].sizes.includes(size)) return widget
    changed = true
    return { ...widget, size }
  })
  return changed ? boardOf(widgets, board.preset) : board
}

/** The next size the widget fits, in its own order (Small → Medium → … → back). */
export function nextSize(widget: BoardWidget, step: 1 | -1 = 1): WidgetSize {
  const order = (['s', 'm', 'l', 'w'] as const).filter((size) =>
    WIDGET_INFO[widget.kind].sizes.includes(size)
  )
  const at = order.indexOf(widget.size)
  return order[(at + step + order.length) % order.length] ?? widget.size
}

/** Moves a widget to `to` (clamped to the board). */
export function moveWidget(board: SummaryBoard, id: string, to: number): SummaryBoard {
  const from = board.widgets.findIndex((widget) => widget.id === id)
  if (from < 0) return board
  const target = Math.max(0, Math.min(board.widgets.length - 1, to))
  if (target === from) return board
  const widgets = [...board.widgets]
  const [widget] = widgets.splice(from, 1)
  if (widget === undefined) return board
  widgets.splice(target, 0, widget)
  return boardOf(widgets, board.preset)
}

/** Moves a widget `delta` places earlier (negative) or later. */
export function moveBy(board: SummaryBoard, id: string, delta: number): SummaryBoard {
  const from = board.widgets.findIndex((widget) => widget.id === id)
  return from < 0 ? board : moveWidget(board, id, from + delta)
}

/** The widget's own engine filter. */
export function setWidgetEngine(
  board: SummaryBoard,
  id: string,
  engine: WidgetEngine
): SummaryBoard {
  let changed = false
  const widgets = board.widgets.map((widget) => {
    if (widget.id !== id || widget.engine === engine) return widget
    changed = true
    return { ...widget, engine }
  })
  return changed ? boardOf(widgets, board.preset) : board
}

/** Ids for a list of specs, in order (tests pass their own). */
function build(
  specs: readonly WidgetSpec[],
  preset: RolePreset | null,
  ids: () => string
): SummaryBoard {
  return boardOf(
    specs.slice(0, MAX_WIDGETS).map((spec) => widgetOf(spec, ids())),
    preset
  )
}

/** Today's Summary as widgets: what a project shows before anyone arranges it. */
export const DEFAULT_SPECS: readonly WidgetSpec[] = [
  { kind: 'headline', size: 'w' },
  { kind: 'results', size: 'w' },
  { kind: 'trend', size: 'l', config: { scope: { kind: 'project' } } },
  { kind: 'cited-sites', size: 'm' },
  { kind: 'next-fixes', size: 'm' },
  { kind: 'changes', size: 'w' }
]

export function defaultBoard(ids: () => string = defaultIds()): SummaryBoard {
  return build(DEFAULT_SPECS, null, ids)
}

/** Stable ids for the default board, so a drill link on it keeps working. */
function defaultIds(): () => string {
  let n = 0
  return () => {
    n += 1
    return `d${n}`
  }
}

/** What a preset may use from the project: its top competitor and a question to watch. */
export interface PresetContext {
  topCompetitor: { domain: string; label: string } | null
  question: { pageId: string; promptId: string; label: string } | null
}

export const PRESET_INFO: Readonly<Record<RolePreset, { title: string; description: string }>> = {
  executive: {
    title: 'SEO executive',
    description: 'The big picture: headline numbers, the trend, engines, fixes and rivals.'
  },
  publisher: {
    title: 'Content publisher',
    description: 'What to write or fix next, and whether your last fixes worked.'
  },
  auditor: {
    title: 'Content auditor',
    description: 'What changed: results, questions gained or lost, page changes and updates.'
  }
}

/** The widgets a role starts with. */
export function presetSpecs(preset: RolePreset, context: PresetContext): WidgetSpec[] {
  const project = { scope: { kind: 'project' as const } }
  const competitor: WidgetSpec[] =
    context.topCompetitor === null
      ? []
      : [
          {
            kind: 'competitor',
            size: 'm',
            config: { domain: context.topCompetitor.domain, label: context.topCompetitor.label }
          }
        ]
  const question: WidgetSpec[] =
    context.question === null
      ? []
      : [
          {
            kind: 'question',
            size: 'm',
            config: {
              pageId: context.question.pageId,
              promptId: context.question.promptId,
              label: context.question.label
            }
          }
        ]
  switch (preset) {
    case 'executive':
      return [
        { kind: 'headline', size: 'w' },
        { kind: 'trend', size: 'l', config: project },
        { kind: 'cited-rate', size: 's' },
        { kind: 'credits', size: 's' },
        { kind: 'fixes-working', size: 'm' },
        { kind: 'engines', size: 'w' },
        ...competitor,
        { kind: 'google-updates', size: 'm' }
      ]
    case 'publisher':
      return [
        { kind: 'next-fixes', size: 'l' },
        { kind: 'fixes-working', size: 'm' },
        { kind: 'page-changes', size: 'm' },
        { kind: 'trend', size: 'w', config: project },
        { kind: 'cited-rate', size: 's' },
        { kind: 'credits', size: 's' },
        ...competitor
      ]
    case 'auditor':
      return [
        { kind: 'results', size: 'w' },
        { kind: 'changes', size: 'w' },
        { kind: 'page-changes', size: 'm' },
        { kind: 'google-updates', size: 'm' },
        { kind: 'cited-sites', size: 'm' },
        ...question,
        { kind: 'engines', size: 'm' }
      ]
  }
}

/** A role's board: replaces every widget (Undo brings the old board back). */
export function presetBoard(
  preset: RolePreset,
  context: PresetContext,
  ids: () => string = () => newWidgetId()
): SummaryBoard {
  return build(presetSpecs(preset, context), preset, ids)
}

/**
 * True when a widget for the same thing is on the board already, so Pin to Summary
 * says "Already on Summary" instead of adding a second one.
 */
export function hasSameWidget(board: SummaryBoard, spec: WidgetSpec): boolean {
  const key = configKey(spec.config ?? {})
  return board.widgets.some(
    (widget) => widget.kind === spec.kind && configKey(widget.config) === key
  )
}

function configKey(config: WidgetConfig): string {
  const scope = config.scope ?? { kind: 'project' }
  return [
    scope.kind,
    scope.id ?? '',
    config.domain ?? '',
    config.pageId ?? '',
    config.promptId ?? ''
  ].join('|')
}

/** Columns each size spans on a board `columns` wide (4, 2 or 1). */
export function spanOf(size: WidgetSize, columns: number): { cols: number; rows: number } {
  const wide = size === 's' ? 1 : size === 'w' ? 4 : 2
  return { cols: Math.min(wide, columns), rows: size === 'l' && columns > 1 ? 2 : 1 }
}
