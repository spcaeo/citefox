import { describe, expect, it } from 'vitest'
import { ALERTS_ROW, ALERTS_URL, ledger, NOW, SCHEDULE_ROW, SCHEDULE_URL } from '../fixtures'
import { backlinkCsv, backlinkRows, missingAnchorIds, urlList } from './model'

describe('Backlink ask list model', () => {
  it('lists pages that need links, First before Next, then longest live first', () => {
    const fresh = {
      ...SCHEDULE_ROW,
      fixId: 'fix-fresh',
      pageId: 'page-fresh',
      daysLive: 5,
      index: null
    }
    const old = { ...SCHEDULE_ROW, fixId: 'fix-old', pageId: 'page-old', daysLive: 30, index: null }
    const rows = backlinkRows(ledger({ rows: [fresh, ...ledger().rows, old] }))
    expect(rows.map((item) => [item.row.fixId, item.priority])).toEqual([
      ['fix-old', 'first'],
      ['fix-alerts', 'first'],
      ['fix-schedule', 'first'],
      ['fix-fresh', 'next']
    ])
    expect(rows.find((item) => item.row.fixId === 'fix-schedule')?.anchor).toBe(
      'schedule text messages from email'
    )
    expect(missingAnchorIds(rows)).toEqual(['page-old', 'page-alerts', 'page-fresh'])
  })

  it('copies every address on its own line', () => {
    expect(urlList(backlinkRows(ledger()))).toBe(`${ALERTS_URL}\n${SCHEDULE_URL}`)
  })

  it('builds the CSV of exactly the listed rows, formula text passed through for main to neutralize', () => {
    const anchors = [
      {
        pageId: 'page-alerts',
        text: '=HYPERLINK("https://evil.test","x")',
        savedAt: NOW.toISOString()
      }
    ]
    const csv = backlinkCsv(backlinkRows(ledger({ anchors })), 'textbolt.com', NOW)
    expect(csv.fileName).toBe('textbolt.com-backlink-ask-list-2026-10-23.csv')
    expect(csv.header).toEqual([
      'Priority',
      'Page',
      'URL',
      'Suggested anchor text',
      'Kind',
      'Live since',
      'Google index',
      'Status'
    ])
    expect(csv.rows).toHaveLength(2)
    expect(csv.rows[0]).toEqual([
      'First',
      ALERTS_ROW.title,
      ALERTS_URL,
      '=HYPERLINK("https://evil.test","x")',
      'Rewrite',
      'Oct 8, 2026',
      'Indexed',
      'Lost ground'
    ])
    expect(csv.rows[1]?.[3]).toBe('')
    expect(csv.rows[1]?.[6]).toBe('Not indexed')
  })
})
