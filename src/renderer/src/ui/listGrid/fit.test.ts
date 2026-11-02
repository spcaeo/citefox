import { describe, expect, it } from 'vitest'
import { gridTemplate } from './columns'
import { columnsFit, fitColumns } from './fit'
import type { ListColumn } from './types'

type Row = { id: string }

const col = (id: string, width: number | 'fill', minWidth?: number): ListColumn<Row> => ({
  id,
  label: id,
  width,
  ...(minWidth !== undefined ? { minWidth } : {}),
  render: () => id
})

const COLUMNS = [col('name', 'fill', 200), col('from', 150), col('before', 104), col('now', 104)]

describe('fitColumns', () => {
  it('keeps every column when they fit or before the width is measured', () => {
    const wide = gridTemplate(COLUMNS, false, false).minWidth
    expect(fitColumns(COLUMNS, ['from'], wide).dropped).toEqual([])
    expect(fitColumns(COLUMNS, ['from'], 0).columns).toBe(COLUMNS)
  })

  it('drops in order only as far as it must', () => {
    const withoutFrom = COLUMNS.filter((column) => column.id !== 'from')
    const width = gridTemplate(withoutFrom, false, false).minWidth
    const fit = fitColumns(COLUMNS, ['from', 'before'], width)
    expect(fit.dropped).toEqual(['from'])
    expect(columnsFit(fit.columns, width)).toBe(true)
    expect(fitColumns(COLUMNS, ['from', 'before'], width - 1).dropped).toEqual(['from', 'before'])
  })

  it('counts the tick box and the row menu', () => {
    const width = gridTemplate(COLUMNS, false, false).minWidth
    expect(columnsFit(COLUMNS, width)).toBe(true)
    expect(columnsFit(COLUMNS, width, { selectable: true, menu: true })).toBe(false)
  })
})
