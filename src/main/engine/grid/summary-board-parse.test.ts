import { describe, expect, test } from 'vitest'
import { parseSetSummaryBoard, parseSummaryBoard } from './parse'

describe('Summary board requests', () => {
  test('reads a project id, and a board it normalizes', () => {
    expect(parseSummaryBoard({ projectId: 'proj-1' })).toEqual({ projectId: 'proj-1' })
    const parsed = parseSetSummaryBoard({
      projectId: 'proj-1',
      board: {
        version: 1,
        preset: null,
        widgets: [
          {
            id: 'w1',
            kind: 'trend',
            size: 'l',
            engine: 'gemini',
            config: { scope: { kind: 'topic', id: 't1' } }
          },
          { id: 'w2', kind: 'nope', size: 'l', engine: 'all', config: {} }
        ]
      }
    })
    expect(parsed.board.widgets).toEqual([
      {
        id: 'w1',
        kind: 'trend',
        size: 'l',
        engine: 'gemini',
        config: { scope: { kind: 'topic', id: 't1' } }
      }
    ])
  })

  test('refuses extra keys and a non-board', () => {
    expect(() => parseSummaryBoard({ projectId: 'proj-1', extra: 1 })).toThrow()
    expect(() => parseSetSummaryBoard({ projectId: 'proj-1', board: { version: 9 } })).toThrow()
    expect(() =>
      parseSetSummaryBoard({ projectId: '../x', board: { version: 1, widgets: [] } })
    ).toThrow()
  })
})
