import { describe, expect, it } from 'vitest'
import { ALERTS_ROW, GMAIL_ROW, ledger, PRICING_ROW, SCHEDULE_ROW } from '../fixes/fixtures'
import { formatMoment } from '../utils/dates'
import { citedDrill, pagesDrill, topSpotsDrill } from './drills'
import {
  averageLabel,
  averagePosition,
  citedRows,
  daysLabel,
  filterRows,
  indexBucket,
  indexTitle,
  pageDateLine,
  questionMoves,
  showCounts,
  speedBars,
  topSpotRows,
  nextFixNumber
} from './model'

describe('Changes ledger model', () => {
  it('counts cited questions, #1 spots and the mean position from the check rows', () => {
    expect(citedRows(ALERTS_ROW.before)).toHaveLength(5)
    expect(citedRows(ALERTS_ROW.now)).toHaveLength(1)
    expect(topSpotRows(PRICING_ROW.now)).toHaveLength(1)
    expect(averagePosition(PRICING_ROW.now)).toBe(2)
    expect(averagePosition(ALERTS_ROW.before)).toBe(1.8)
    expect(averageLabel(averagePosition(SCHEDULE_ROW.now))).toBe('—')
    expect(citedRows(null)).toEqual([])
  })

  it('filters the ledger with counts that equal the rows each filter shows', () => {
    const rows = ledger().rows
    const counts = showCounts(rows)
    expect(counts).toMatchObject({
      all: 4,
      cited: 1,
      not_cited: 1,
      too_new: 1,
      lost: 1,
      not_indexed: 1,
      'kind:new_page': 2,
      'kind:rewrite': 1,
      'kind:fix': 1
    })
    for (const [show, count] of Object.entries(counts)) {
      expect(filterRows(rows, show as keyof typeof counts)).toHaveLength(count)
    }
    expect(filterRows(rows, 'not_indexed').map((row) => row.fixId)).toEqual(['fix-schedule'])
  })

  it('buckets the newest change on each page by days live for the speed chart', () => {
    const older = { ...PRICING_ROW, fixId: 'fix-old', latestOnPage: false, daysLive: 1 }
    const bars = speedBars(ledger({ rows: [...ledger().rows, older] }))
    expect(bars.map((bar) => [bar.id, bar.rows.length, bar.cited.length])).toEqual([
      ['0-3', 1, 0],
      ['4-7', 0, 0],
      ['8-13', 2, 1],
      ['14+', 1, 1]
    ])
    expect(bars[2]?.share).toBe(0.5)
    expect(bars[1]?.share).toBe(0)
  })

  it('reads the index state, its title, the page’s own date and days live', () => {
    expect(indexBucket(SCHEDULE_ROW)).toBe('not_indexed')
    expect(indexBucket(GMAIL_ROW)).toBe('not_checked')
    expect(
      indexBucket({
        index: { state: 'unknown', checkedAt: '2026-10-21T00:00:00Z', message: 'Search failed' }
      })
    ).toBe('not_checked')
    expect(
      indexTitle({
        index: { state: 'unknown', checkedAt: '2026-10-21T12:00:00Z', message: 'Search failed' }
      })
    ).toBe(`Checked ${formatMoment('2026-10-21T12:00:00Z')}: Search failed`)
    expect(indexTitle(GMAIL_ROW)).toBe('Not checked with Google yet')
    expect(pageDateLine(ALERTS_ROW)).toBe('Updated Oct 8 on the page')
    expect(pageDateLine(SCHEDULE_ROW)).toBe('Published Oct 12 on the page')
    expect(pageDateLine(PRICING_ROW)).toBeNull()
    expect(daysLabel(1)).toBe('1 day')
    expect(daysLabel(-2)).toBe('Goes live in 2 days')
    expect(daysLabel(null)).toBe('—')
  })

  it('lists every question before and now in question order', () => {
    const moves = questionMoves(ALERTS_ROW)
    expect(moves).toHaveLength(7)
    expect(moves[1]?.before?.status).toBe('page_cited')
    expect(moves[1]?.now?.status).toBe('other_own_page')
    expect(questionMoves(SCHEDULE_ROW).every((move) => move.before === null)).toBe(true)
    expect(nextFixNumber(ledger().rows, 'page-alerts')).toBe(3)
  })

  it('drills hold exactly the rows their numbers count', () => {
    const context = ledger()
    expect(citedDrill(context, ALERTS_ROW, 'before')?.rows).toHaveLength(5)
    expect(citedDrill(context, ALERTS_ROW, 'before')?.scope.runId).toBe('run-alerts-1')
    expect(citedDrill(context, ALERTS_ROW, 'now')?.rows).toHaveLength(1)
    expect(citedDrill(context, SCHEDULE_ROW, 'before')).toBeNull()
    expect(topSpotsDrill(context, PRICING_ROW)?.rows).toHaveLength(1)
    const pages = pagesDrill(context, [ALERTS_ROW, PRICING_ROW], {
      id: 'x',
      title: 'Pages',
      description: ''
    })
    expect(pages.items.map((item) => item.target)).toEqual([
      { kind: 'hash', hash: '#/fixes?view=changes&row=fix-alerts' },
      { kind: 'hash', hash: '#/fixes?view=changes&row=fix-pricing' }
    ])
    expect(pages.items[0]?.cells).toMatchObject({
      status: 'Lost ground',
      cited: 1,
      kind: 'Rewrite'
    })
  })
})
