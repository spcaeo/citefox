import { describe, expect, test } from 'vitest'
import { fixSearches } from '../../fixes/searchFixtures'
import { citationPages, pagesFooter } from './model'

describe('Citations · Pages model', () => {
  const { rows, view, rollup } = citationPages(fixSearches())

  test('your pages, then the sites cited instead, then what needs no page', () => {
    expect(
      rows.map((row) => [
        row.section,
        row.kind,
        row.url ?? row.domain,
        row.citedFor.length,
        row.toWin.length
      ])
    ).toEqual([
      ['yours', 'target', 'https://textbolt.com/integration/nagios-email-to-text-alerts', 2, 4],
      ['yours', 'target', 'https://textbolt.com/pricing', 1, 2],
      ['yours', 'other', 'https://textbolt.com/blog/nagios-setup/', 2, 0],
      ['yours', 'new', null, 0, 3],
      ['instead', 'site', 'nagios.org', 9, 0],
      ['instead', 'site', 'reddit.com', 9, 0],
      ['none', 'noAio', null, 2, 0],
      ['none', 'notChecked', null, 1, 0]
    ])
  })

  test('each page leads to its fix in What to fix', () => {
    const byKind = new Map(rollup.fixes.map((fix) => [fix.id, fix.kind]))
    expect(rows.map((row) => (row.fixId ? byKind.get(row.fixId) : null))).toEqual([
      'improve',
      'improve',
      'owner',
      'new',
      null,
      null,
      null,
      null
    ])
  })

  test('the footer adds up to every search', () => {
    expect(view.total).toBe(fixSearches().length)
    const counted = rows
      .filter((row) => row.section !== 'instead')
      .reduce((sum, row) => sum + row.citedFor.length + row.toWin.length, 0)
    expect(counted).toBe(view.total)
    expect(pagesFooter(view)).toBe(
      'Your pages: 2 + 1 + 2 cited · 9 still to win · 2 need no page · 1 not checked yet = 17'
    )
    expect(pagesFooter(citationPages([]).view)).toBe(
      'Your pages: 0 cited · 0 still to win · 0 need no page = 0'
    )
  })
})
