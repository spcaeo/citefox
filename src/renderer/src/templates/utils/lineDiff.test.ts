import { describe, expect, test } from 'vitest'
import { changedLines, diffSummary, diffSummaryText, lineDiff } from './lineDiff'

describe('lineDiff', () => {
  test('identical bodies have no changed lines', () => {
    const lines = lineDiff('a\nb\nc', 'a\nb\nc')
    expect(changedLines(lines)).toEqual([])
    expect(diffSummaryText(diffSummary(lines))).toBe('')
  })

  test('a trailing newline does not count as a change', () => {
    expect(changedLines(lineDiff('a\nb\n', 'a\nb'))).toEqual([])
  })

  test('additions and removals keep their order around unchanged lines', () => {
    const lines = lineDiff('one\ntwo\nthree\nfour', 'one\nTWO\nthree\nfour\nfive')
    expect(lines).toEqual([
      { kind: 'same', text: 'one' },
      { kind: 'remove', text: 'two' },
      { kind: 'add', text: 'TWO' },
      { kind: 'same', text: 'three' },
      { kind: 'same', text: 'four' },
      { kind: 'add', text: 'five' }
    ])
    expect(diffSummary(lines)).toEqual({ added: 2, removed: 1 })
    expect(diffSummaryText(diffSummary(lines))).toBe('2 lines added, 1 removed')
  })

  test('an empty side is all additions or all removals', () => {
    expect(lineDiff('', 'x\ny')).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'add', text: 'y' }
    ])
    expect(lineDiff('x', '')).toEqual([{ kind: 'remove', text: 'x' }])
    expect(diffSummaryText({ added: 0, removed: 1 })).toBe('1 line removed')
    expect(diffSummaryText({ added: 1, removed: 0 })).toBe('1 line added')
  })

  test('the longest common run of lines stays unchanged', () => {
    const shipped = ['intro', 'Step 1', 'Step 2', 'Step 3', 'outro'].join('\n')
    const mine = ['intro', 'Step 2', 'Step 3', 'Step 4', 'outro'].join('\n')
    expect(changedLines(lineDiff(shipped, mine))).toEqual([
      { kind: 'remove', text: 'Step 1' },
      { kind: 'add', text: 'Step 4' }
    ])
  })

  test('Windows line endings compare like Unix ones', () => {
    expect(changedLines(lineDiff('a\r\nb', 'a\nb'))).toEqual([])
  })
})
