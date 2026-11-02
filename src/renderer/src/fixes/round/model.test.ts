import { describe, expect, it } from 'vitest'
import { GMAIL_ROW, ledger, SCHEDULE_ROW } from '../fixtures'
import {
  cleanOwner,
  indexByDays,
  indexPageIds,
  notIndexedRows,
  previewLine,
  roundCounts,
  scheduleLine,
  tooNewRows,
  unmeasuredRows
} from './model'

const ids = (rows: readonly { fixId: string }[]): string[] => rows.map((row) => row.fixId)

describe('Next round model', () => {
  it('counts each step from the ledger rows with the shared rules', () => {
    const counts = roundCounts(ledger())
    expect(counts.measure).toBe(6)
    expect(ids(counts.reoptimise)).toEqual(['fix-schedule', 'fix-alerts'])
    expect(ids(counts.publish)).toEqual([])
    expect(ids(counts.index)).toEqual(['fix-gmail', 'fix-schedule'])
    expect(ids(counts.backlinks)).toEqual(['fix-alerts', 'fix-schedule'])
    expect(ids(tooNewRows(ledger()))).toEqual(['fix-gmail'])
    expect(ids(notIndexedRows(ledger()))).toEqual(['fix-schedule'])
  })

  it('publish counts changes live since the last check, or going live later', () => {
    const base = ledger()
    const later = {
      ...GMAIL_ROW,
      fixId: 'fix-later',
      daysLive: -2,
      liveSince: '2026-10-25T00:00:00.000Z'
    }
    const withLater = ledger({ rows: [later, ...base.rows] })
    expect(ids(unmeasuredRows(withLater))).toEqual(['fix-later'])
    const earlier = ledger({
      schedule: { ...base.schedule, lastCheckAt: '2026-10-20T00:00:00.000Z' }
    })
    expect(ids(unmeasuredRows(earlier))).toEqual(['fix-gmail'])
    const never = ledger({ schedule: { ...base.schedule, lastCheckAt: null } })
    expect(unmeasuredRows(never)).toHaveLength(4)
  })

  it('says when the next measurement runs', () => {
    const schedule = ledger().schedule
    expect(scheduleLine(schedule)).toBe('Next measurement on Nov 2, then every 14 days.')
    expect(scheduleLine({ ...schedule, nextCheckAt: null })).toBe('No check is scheduled.')
    expect(scheduleLine({ ...schedule, paused: true })).toMatch(/^Paused/)
  })

  it('cleans owner labels to the limit; empty resets', () => {
    expect(cleanOwner('  Priya  ')).toBe('Priya')
    expect(cleanOwner('x'.repeat(60))).toHaveLength(40)
    expect(cleanOwner('   ')).toBe('')
  })

  it('checks each live changed page once and words the preview', () => {
    const later = { ...SCHEDULE_ROW, fixId: 'fix-later', pageId: 'page-later', daysLive: -1 }
    expect(indexPageIds(ledger({ rows: [later, ...ledger().rows] }))).toEqual([
      'page-gmail',
      'page-schedule',
      'page-pricing',
      'page-alerts'
    ])
    const preview = {
      pages: 4,
      searchesMin: 4,
      searchesMax: 8,
      left: 52,
      canRun: true,
      reason: null
    }
    expect(previewLine(preview)).toBe(
      'Checks 4 pages with a Google site: search. Uses 4–8 searches; 52 left this month.'
    )
    expect(previewLine({ ...preview, pages: 1, searchesMin: 1, searchesMax: 1, left: null })).toBe(
      'Checks 1 page with a Google site: search. Uses 1 search.'
    )
  })

  it('splits changed pages by days live and index state', () => {
    const rows = indexByDays(ledger())
    expect(
      rows.map((row) => [
        row.id,
        row.rows.length,
        row.byIndex.indexed.length,
        row.byIndex.not_indexed.length,
        row.byIndex.not_checked.length
      ])
    ).toEqual([
      ['0-3', 1, 0, 0, 1],
      ['4-7', 0, 0, 0, 0],
      ['8-13', 2, 1, 1, 0],
      ['14+', 1, 1, 0, 0]
    ])
  })
})
