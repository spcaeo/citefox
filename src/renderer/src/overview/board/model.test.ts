import { afterEach, describe, expect, it } from 'vitest'
import { MAX_WIDGETS, normalizeBoard, type SummaryBoard } from '@shared/summary-board'
import {
  addWidget,
  defaultBoard,
  hasSameWidget,
  moveBy,
  moveWidget,
  nextSize,
  presetBoard,
  removeWidget,
  resizeWidget,
  restoreWidget,
  setWidgetEngine,
  spanOf,
  type PresetContext
} from './model'
import {
  boardInMemory,
  loadBoard,
  pinWidget,
  resetBoardMemory,
  saveBoard,
  type BoardStore
} from './store'

function ids(): () => string {
  let n = 0
  return () => {
    n += 1
    return `t${n}`
  }
}

const kinds = (board: SummaryBoard): string[] => board.widgets.map((widget) => widget.kind)
const order = (board: SummaryBoard): string[] => board.widgets.map((widget) => widget.id)

const CONTEXT: PresetContext = {
  topCompetitor: { domain: 'textus.com', label: 'TextUs' },
  question: { pageId: 'page-1', promptId: 'p-1', label: 'best sms app' }
}

afterEach(() => resetBoardMemory())

describe('the Summary board model', () => {
  it('starts as today’s Summary, in today’s order, with stable ids', () => {
    const board = defaultBoard()
    expect(kinds(board)).toEqual([
      'headline',
      'results',
      'trend',
      'cited-sites',
      'next-fixes',
      'changes'
    ])
    expect(order(board)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'])
    expect(board.widgets.map((widget) => widget.size)).toEqual(['w', 'w', 'l', 'm', 'm', 'w'])
    expect(board.widgets.every((widget) => widget.engine === 'all')).toBe(true)
  })

  it('adds a widget at the end with its default size, and stops when full', () => {
    const board = addWidget(defaultBoard(), { kind: 'cited-rate', engine: 'chatgpt' }, 'x')
    expect(board.widgets.at(-1)).toEqual({
      id: 'x',
      kind: 'cited-rate',
      size: 's',
      engine: 'chatgpt',
      config: {}
    })
    // A size the widget does not fit falls back to its default.
    expect(addWidget(board, { kind: 'cited-rate', size: 'w' }, 'y').widgets.at(-1)?.size).toBe('s')
    // A widget with no engine filter stays on All.
    expect(
      addWidget(board, { kind: 'next-fixes', engine: 'chatgpt' }, 'z').widgets.at(-1)?.engine
    ).toBe('all')
    let full = board
    const next = ids()
    while (full.widgets.length < MAX_WIDGETS) full = addWidget(full, { kind: 'credits' }, next())
    expect(addWidget(full, { kind: 'credits' }, 'over')).toBe(full)
  })

  it('removes a widget and Undo puts it back where it stood', () => {
    const board = defaultBoard()
    const { board: without, removed } = removeWidget(board, 'd3')
    expect(order(without)).toEqual(['d1', 'd2', 'd4', 'd5', 'd6'])
    expect(removed?.index).toBe(2)
    expect(order(restoreWidget(without, removed!))).toEqual(order(board))
    // Undo after another change still finds a place.
    const shorter = removeWidget(without, 'd1').board
    expect(order(restoreWidget(shorter, removed!))).toEqual(['d2', 'd4', 'd3', 'd5', 'd6'])
    expect(removeWidget(board, 'nope').removed).toBeNull()
  })

  it('resizes only to sizes the widget fits, and cycles through them', () => {
    const board = defaultBoard()
    expect(resizeWidget(board, 'd4', 'l').widgets[3]?.size).toBe('l')
    // Who gets cited never shrinks to Small.
    expect(resizeWidget(board, 'd4', 's')).toBe(board)
    const sites = board.widgets[3]!
    expect(nextSize(sites)).toBe('l')
    expect(nextSize({ ...sites, size: 'w' })).toBe('m')
    expect(nextSize(sites, -1)).toBe('w')
  })

  it('reorders by place and by steps, clamped to the board', () => {
    const board = defaultBoard()
    expect(order(moveWidget(board, 'd6', 0))).toEqual(['d6', 'd1', 'd2', 'd3', 'd4', 'd5'])
    expect(order(moveBy(board, 'd1', 1))).toEqual(['d2', 'd1', 'd3', 'd4', 'd5', 'd6'])
    expect(moveBy(board, 'd1', -1)).toBe(board)
    expect(order(moveWidget(board, 'd2', 99))).toEqual(['d1', 'd3', 'd4', 'd5', 'd6', 'd2'])
  })

  it('keeps each widget’s own engine', () => {
    const board = setWidgetEngine(defaultBoard(), 'd2', 'perplexity')
    expect(board.widgets.map((widget) => widget.engine)).toEqual([
      'all',
      'perplexity',
      'all',
      'all',
      'all',
      'all'
    ])
  })

  it('fills the board from a role preset', () => {
    const executive = presetBoard('executive', CONTEXT, ids())
    expect(executive.preset).toBe('executive')
    expect(kinds(executive)).toEqual([
      'headline',
      'trend',
      'cited-rate',
      'credits',
      'fixes-working',
      'engines',
      'competitor',
      'google-updates'
    ])
    expect(executive.widgets.find((widget) => widget.kind === 'competitor')?.config).toEqual({
      domain: 'textus.com',
      label: 'TextUs'
    })
    expect(kinds(presetBoard('publisher', CONTEXT, ids()))[0]).toBe('next-fixes')
    const auditor = presetBoard('auditor', { topCompetitor: null, question: null }, ids())
    expect(kinds(auditor)).not.toContain('question')
    expect(kinds(presetBoard('auditor', CONTEXT, ids()))).toContain('question')
  })

  it('knows a widget for the same thing is there already', () => {
    const board = addWidget(
      defaultBoard(),
      { kind: 'trend', config: { scope: { kind: 'topic', id: 't1' } } },
      'x'
    )
    expect(
      hasSameWidget(board, { kind: 'trend', config: { scope: { kind: 'topic', id: 't1' } } })
    ).toBe(true)
    expect(
      hasSameWidget(board, { kind: 'trend', config: { scope: { kind: 'topic', id: 't2' } } })
    ).toBe(false)
    // The default trend is the project's.
    expect(hasSameWidget(board, { kind: 'trend' })).toBe(true)
  })

  it('spans 4 columns, 2 on a narrower window, 1 on a narrow one', () => {
    expect(spanOf('s', 4)).toEqual({ cols: 1, rows: 1 })
    expect(spanOf('l', 4)).toEqual({ cols: 2, rows: 2 })
    expect(spanOf('w', 2)).toEqual({ cols: 2, rows: 1 })
    expect(spanOf('l', 1)).toEqual({ cols: 1, rows: 1 })
  })

  it('survives a save and load: what the model makes, the store keeps', () => {
    const board = presetBoard('executive', CONTEXT, ids())
    expect(normalizeBoard(JSON.parse(JSON.stringify(board)))).toEqual(board)
  })
})

function memoryStore(
  saved: SummaryBoard | null = null
): BoardStore & { saved: SummaryBoard | null; sets: number } {
  const store = {
    saved,
    sets: 0,
    get: async () => store.saved,
    set: async (_projectId: string, board: SummaryBoard) => {
      store.saved = board
      store.sets += 1
    }
  }
  return store
}

describe('the board store', () => {
  it('shows today’s Summary for a project never arranged, and the saved board after', async () => {
    const store = memoryStore()
    expect(order(await loadBoard('p1', store))).toEqual(order(defaultBoard()))
    const moved = moveBy(await loadBoard('p1', store), 'd1', 2)
    await saveBoard('p1', moved, store)
    expect(store.sets).toBe(1)
    // A new session (memory cleared) reads the saved board back.
    resetBoardMemory()
    expect(order(await loadBoard('p1', store))).toEqual(order(moved))
  })

  it('pins once, then says it is there already, or that the board is full', async () => {
    const store = memoryStore()
    const spec = { kind: 'competitor' as const, config: { domain: 'textus.com', label: 'TextUs' } }
    expect(await pinWidget('p1', spec, store)).toBe('added')
    expect(boardInMemory('p1')?.widgets.at(-1)?.config.domain).toBe('textus.com')
    expect(await pinWidget('p1', spec, store)).toBe('exists')
    let full = boardInMemory('p1')!
    const next = ids()
    while (full.widgets.length < MAX_WIDGETS) full = addWidget(full, { kind: 'credits' }, next())
    await saveBoard('p1', full, store)
    expect(await pinWidget('p1', { kind: 'cited-rate' }, store)).toBe('full')
  })

  it('keeps a board in memory when there is no store (tests, a preview)', async () => {
    const board = await loadBoard('p2', null)
    await saveBoard('p2', removeWidget(board, 'd1').board, null)
    expect(boardInMemory('p2')?.widgets).toHaveLength(5)
  })
})
