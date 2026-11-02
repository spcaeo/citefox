import { describe, expect, test } from 'vitest'
import type { TopicRowState } from './domain'
import { pagesView, pagesViewCounts, pagesViewTotal, type PagesViewRow } from './pages-view'

const T = 'https://textbolt.com/integration/nagios'
const OTHER = 'https://textbolt.com/blog/nagios-setup/'
const PRICING = 'https://textbolt.com/pricing'

let next = 0
function row(state: TopicRowState, extra: Partial<PagesViewRow> = {}): PagesViewRow {
  next += 1
  return {
    promptId: `p${next}`,
    state,
    targetPageId: 'page-t',
    targetUrl: T,
    citedOwnUrl: state === 'right_page' ? T : null,
    citedInstead: [],
    ...extra
  }
}

describe('pagesView', () => {
  const rows = [
    row('right_page'),
    row('right_page'),
    row('other_page', { citedOwnUrl: OTHER }),
    row('other_page', { citedOwnUrl: `${OTHER}?ref=x` }),
    row('other_page', { citedOwnUrl: PRICING }),
    row('not_cited', { citedInstead: ['reddit.com', 'nagios.org'] }),
    row('not_cited', { citedInstead: ['reddit.com', 'reddit.com'] }),
    row('no_page', { targetUrl: null, targetPageId: null, citedInstead: ['nagios.org'] }),
    row('no_aio'),
    row('no_aio'),
    row('failed'),
    row('not_checked')
  ]
  const view = pagesView(rows)

  test('target first, then your other pages, most cited first', () => {
    expect(view.pages.map((page) => [page.url, page.role])).toEqual([
      [T, 'target'],
      [OTHER, 'other'],
      [PRICING, 'other']
    ])
    expect(view.pages[0]?.citedFor).toHaveLength(2)
    expect(view.pages[0]?.toWin).toHaveLength(2)
    expect(view.pages[0]?.pageId).toBe('page-t')
    // The same page with a query is one page.
    expect(view.pages[1]?.citedFor).toHaveLength(2)
  })

  test('sites cited instead count each search once', () => {
    expect(view.sites).toEqual([
      { domain: 'nagios.org', searches: ['p6', 'p8'] },
      { domain: 'reddit.com', searches: ['p6', 'p7'] }
    ])
  })

  test('every search lands once: the footer adds up to all rows', () => {
    expect(view.total).toBe(rows.length)
    expect(pagesViewTotal(view)).toBe(rows.length)
    expect(pagesViewCounts(view)).toEqual({
      cited: 5,
      toWin: 2,
      noPage: 1,
      noAio: 2,
      notChecked: 2
    })
  })

  test('a target with nothing cited or to win still shows as your page', () => {
    const only = pagesView([row('no_aio')])
    expect(only.pages.map((page) => [page.url, page.citedFor.length, page.toWin.length])).toEqual([
      [T, 0, 0]
    ])
    expect(pagesViewTotal(only)).toBe(1)
  })

  test('a page cited as "other" that is a target elsewhere is a target page', () => {
    const mixed = pagesView([
      row('other_page', { citedOwnUrl: PRICING }),
      row('not_cited', { targetUrl: PRICING, targetPageId: 'page-p' })
    ])
    const pricing = mixed.pages.find((page) => page.url === PRICING)
    expect(pricing?.role).toBe('target')
    expect(pricing?.citedFor).toHaveLength(1)
    expect(pricing?.toWin).toHaveLength(1)
  })

  test('ids win over prompt ids when prompt ids repeat', () => {
    const across = pagesView([
      { ...row('no_aio'), promptId: 'p1', id: 'a|p1' },
      { ...row('no_aio'), promptId: 'p1', id: 'b|p1' }
    ])
    expect(across.noAio).toEqual(['a|p1', 'b|p1'])
  })
})
