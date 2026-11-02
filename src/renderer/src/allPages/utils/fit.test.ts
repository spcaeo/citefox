import { describe, expect, it } from 'vitest'
import type { AllPageRow } from '@shared/ipc'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { gridTemplate } from '../../ui/listGrid/columns'
import { allPagesColumns } from './columns'
import { fitHidden, NARROW_DROPS } from './fit'
import { DEFAULT_HIDDEN, toListColumns } from './listColumns'

const COLUMNS = allPagesColumns({
  markets: new Map(),
  hasClusters: false,
  hasGroups: false,
  now: new Date(2026, 9, 23),
  onDrill: () => undefined
})
const ASK = askColumn<AllPageRow>(() => null)

/** The grid card's inner width in a 1134px window: sidebar 220, page gutters 2 × 32, scrollbar, card borders. */
const AT_1134 = 1134 - 220 - 64 - 16 - 2

function rowWidth(hidden: readonly string[]): number {
  return gridTemplate([...toListColumns(COLUMNS, hidden), ASK], true, true).minWidth
}

function shown(hidden: readonly string[]): string[] {
  return toListColumns(COLUMNS, hidden).map((column) => column.id)
}

describe('All pages columns fit the window', () => {
  it('a 1134px window drops Updated, Next check, then the link count, and the row fits with ✦', () => {
    expect(rowWidth(DEFAULT_HIDDEN)).toBeGreaterThan(AT_1134)
    const hidden = fitHidden(COLUMNS, DEFAULT_HIDDEN, AT_1134, [ASK])
    expect(hidden).toEqual([...DEFAULT_HIDDEN, ...NARROW_DROPS])
    expect(rowWidth(hidden)).toBeLessThanOrEqual(AT_1134)
    expect(shown(hidden)).toEqual(['page', 'score', 'change', 'cited', 'status'])
  })

  it('drops only what it must: a wider window keeps the link count, a wide one keeps all', () => {
    const full = rowWidth(DEFAULT_HIDDEN)
    expect(fitHidden(COLUMNS, DEFAULT_HIDDEN, full - 1, [ASK])).toEqual([
      ...DEFAULT_HIDDEN,
      'updated'
    ])
    expect(fitHidden(COLUMNS, DEFAULT_HIDDEN, full, [ASK])).toBe(DEFAULT_HIDDEN)
    expect(fitHidden(COLUMNS, DEFAULT_HIDDEN, 1440, [ASK])).toBe(DEFAULT_HIDDEN)
  })

  it('keeps a person’s own column choice, and the default before the width is known', () => {
    const own = DEFAULT_HIDDEN.filter((id) => id !== 'last')
    expect(fitHidden(COLUMNS, own, AT_1134, [ASK])).toBe(own)
    expect(fitHidden(COLUMNS, DEFAULT_HIDDEN, 0, [ASK])).toBe(DEFAULT_HIDDEN)
  })
})
