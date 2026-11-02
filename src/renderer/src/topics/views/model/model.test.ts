import { describe, expect, test } from 'vitest'
import { textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import { ATT_TARGET, attFirstCheck, attTopicResults } from '../fixtures.test-helper'
import { searchesBrief } from './brief'
import { bestNextMove, stageGrid } from './grid'
import { pageFixCount } from './fixLink'
import { pagesView } from './pages'
import { compareSearches, totalsOf } from './results'
import { filterSearches, matchText, searchesOfTopic } from './searches'
import { resultTree, stageTree } from './tree'
import { SEARCH_RESULTS, type TreeNode } from './types'

function leaves(nodes: readonly TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.search ? 1 : leaves(node.children)), 0)
}

/** Every group's totals equal the sum of its children's, all the way down. */
function expectAddsUp(nodes: readonly TreeNode[]): void {
  for (const node of nodes) {
    if (node.search) continue
    expect(node.totals.searches).toBe(leaves(node.children))
    for (const result of SEARCH_RESULTS) {
      expect(node.children.reduce((sum, child) => sum + child.totals.counts[result], 0)).toBe(
        node.totals.counts[result]
      )
    }
    expectAddsUp(node.children)
  }
}

describe('searches of the AT&T topic (mock-up board "Topic")', () => {
  const searches = searchesOfTopic(attTopicResults())

  test('12 searches = 6 not cited, 5 your other page, 0 target, 1 no AI Overview', () => {
    const totals = totalsOf(searches)
    expect(totals.searches).toBe(12)
    expect(totals.counts).toEqual({
      not_cited: 6,
      other_page: 5,
      target: 0,
      no_overview: 1,
      not_checked: 0
    })
    expect(totals.needsWork).toBe(11)
    expect(totals.withAio).toBe(11)
    expect(totals.targetPct).toBe(0)
  })

  test('Q3 has no AI Overview and is still one of the searches', () => {
    const q3 = searches.find((search) => search.ref === 'Q3')
    expect(q3).toMatchObject({ result: 'no_overview', stage: 'doubts', winOdds: null })
  })

  test('each search carries its stage, type, sites cited instead, page cited and odds', () => {
    expect(searches.find((search) => search.ref === 'Q4')).toMatchObject({
      kind: 'question',
      stage: 'compare',
      result: 'other_page',
      pageCited: 'https://textbolt.com/integration/nagios-email-to-text-alerts',
      citedInstead: ['twilio.com'],
      winOdds: 77
    })
    // A keyword with no page of its own aims at the topic's target page.
    expect(searches.find((search) => search.ref === 'K2')).toMatchObject({
      kind: 'keyword',
      stage: null,
      result: 'not_cited',
      targetUrl: ATT_TARGET
    })
  })

  test('the tree adds up at every level', () => {
    const tree = stageTree(searches)
    expectAddsUp(tree)
    expect(tree.reduce((sum, node) => sum + node.totals.searches, 0)).toBe(12)
    expect(tree.map((node) => node.label)).toEqual([
      'Problem',
      'Options',
      'Doubts',
      'Fit',
      'Compare',
      'Decide',
      'Keywords'
    ])
    const doubts = tree.find((node) => node.id === 'stage:doubts')
    expect(doubts?.children.map((node) => node.id)).toEqual([
      'stage:doubts/result:other_page',
      'stage:doubts/result:no_overview'
    ])
    expect(doubts?.children[0]?.note).toBe('mostly /blog/att-email-to-text-shutdown/')
  })

  test('the result tree shows the what-to-do line on each result, best odds first', () => {
    const tree = resultTree(searches, 'Nov 12')
    expectAddsUp(tree)
    expect(tree.map((node) => [node.label, node.totals.searches])).toEqual([
      ['Not cited', 6],
      ['Your other page is cited', 5],
      ['No AI Overview', 1]
    ])
    expect(tree[0]?.note).toBe('Improve the target page, highest win odds first.')
    expect(tree[2]?.note).toBe('Nothing to do: Google answered without one. Checked again Nov 12.')
    expect(tree[0]?.children.map((node) => node.search?.ref)).toEqual([
      'Q5',
      'Q2',
      'Q6',
      'Q8',
      'K1',
      'K2'
    ])
  })

  test('the grid: stage × result, rows and columns add up to All', () => {
    const grid = stageGrid(searches)
    expect(grid.results).toEqual(['not_cited', 'other_page', 'target', 'no_overview'])
    expect(grid.all.cells.map((cell) => cell.count)).toEqual([6, 5, 0, 1])
    for (const row of grid.rows) {
      expect(row.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(row.totals.searches)
    }
    grid.results.forEach((result, index) => {
      expect(grid.rows.reduce((sum, row) => sum + (row.cells[index]?.count ?? 0), 0)).toBe(
        grid.all.totals.counts[result]
      )
    })
    const keywords = grid.rows.find((row) => row.id === 'kw')
    expect(keywords).toMatchObject({ label: 'Keywords', hint: '(no stage)' })
    expect(keywords?.cells[0]?.filter).toEqual({ kind: 'keyword', result: 'not_cited' })
    expect(bestNextMove(grid, searches)).toMatchObject({
      label: 'Keywords',
      count: 2,
      filter: { kind: 'keyword', result: 'not_cited' }
    })
  })

  test('the pages view: target first, other pages, sites, no page needed; the sum holds', () => {
    const view = pagesView(searches)
    expect(view.pages[0]).toMatchObject({
      url: ATT_TARGET,
      role: 'target',
      citedFor: 0,
      stillToWin: 6
    })
    expect(view.pages.slice(1).every((page) => page.role === 'other' && page.citedFor === 1)).toBe(
      true
    )
    expect(view.pages).toHaveLength(6)
    expect(view.noAio).toBe(1)
    // Six not cited improve the one target page (one fix); five cite five other own
    // pages, each its own "pick which page owns it" fix, as Fixes counts them.
    expect(pageFixCount(searches)).toBe(6)
    expect(view.cited + view.stillToWin + view.noAio + view.notChecked).toBe(view.total)
    expect(view.pages.reduce((sum, page) => sum + page.citedFor + page.stillToWin, 0)).toBe(11)
    expect(view.sites[0]).toEqual({
      domain: 'reddit.com',
      searches: 5,
      filter: { site: 'reddit.com' }
    })
    expect(view.pages[0]?.breakdown.map((part) => [part.label, part.cited, part.toWin])).toEqual([
      ['Problem', 0, 1],
      ['Options', 0, 1],
      ['Fit', 0, 1],
      ['Decide', 0, 1],
      ['Keywords', 0, 2]
    ])
  })

  test('filters and text search find the drill rows', () => {
    expect(
      filterSearches(searches, { stage: 'problem', result: 'not_cited' }).map((s) => s.ref)
    ).toEqual(['Q5'])
    expect(filterSearches(searches, { site: 'reddit.com' })).toHaveLength(5)
    expect(filterSearches(searches, { page: ATT_TARGET })).toHaveLength(6)
    expect(filterSearches(searches, { stage: 'none' }).map((s) => s.ref)).toEqual([
      'K1',
      'K2',
      'K3',
      'K4'
    ])
    expect(matchText(searches, 'q7').map((s) => s.ref)).toEqual(['Q7'])
    expect(matchText(searches, 'twilio').map((s) => s.ref)).toEqual(['Q4'])
  })

  test('a first check with nothing cited keeps all 12 and ranks the best odds (Q4, 77) first', () => {
    const first = searchesOfTopic(attFirstCheck())
    expect(totalsOf(first).counts).toMatchObject({ not_cited: 11, target: 0, no_overview: 1 })
    expect([...first].sort(compareSearches)[0]?.ref).toBe('Q4')
  })
})

describe('the big TextBolt topic', () => {
  const results = textboltTopicResults()
  const searches = searchesOfTopic(results)

  test('every search is in the tree once and every row adds up', () => {
    const tree = stageTree(searches)
    expectAddsUp(tree)
    expect(leaves(tree)).toBe(results.rows.length)
    const keywords = tree.find((node) => node.id === 'kw')
    expect(keywords?.totals.searches).toBe(118)
    expect(keywords?.children.at(-1)?.label).toBe('Other keywords')
  })

  test('the grid and the pages view agree with the topic totals', () => {
    const totals = totalsOf(searches)
    expect(stageGrid(searches).all.totals).toEqual(totals)
    const view = pagesView(searches)
    expect(view.cited + view.stillToWin + view.noAio + view.notChecked).toBe(searches.length)
  })
})

describe('the fix brief for several searches', () => {
  test('lists the searches best odds first with the sites cited instead', () => {
    const searches = filterSearches(searchesOfTopic(attTopicResults()), { result: 'not_cited' })
    const brief = searchesBrief({
      title: 'Searches where you are not cited',
      topicName: 'AT&T email-to-text gateway replacement',
      marketName: 'US · EN',
      targetUrl: ATT_TARGET,
      searches
    })
    expect(brief.split('\n').slice(0, 6)).toEqual([
      'Fix brief: Searches where you are not cited (US · EN)',
      'Topic: AT&T email-to-text gateway replacement',
      `Page to improve: ${ATT_TARGET}`,
      'What to do: Improve the target page, highest win odds first.',
      '',
      'Searches (6), best win odds first:'
    ])
    expect(brief).toContain('- Q5: Our dispatchers')
    expect(brief.indexOf('Q5:')).toBeLessThan(brief.indexOf('Q2:'))
    expect(brief).toContain('- reddit.com: 4 searches')
  })

  test('searches with different target pages each name their own', () => {
    const [first, second] = searchesOfTopic(attTopicResults())
    if (!first || !second) throw new Error('fixture')
    const brief = searchesBrief({
      title: 'Two searches',
      topicName: 'Every topic and page',
      marketName: 'US · EN',
      targetUrl: null,
      perSearchTarget: true,
      searches: [
        { ...first, targetUrl: 'https://textbolt.com/a/' },
        { ...second, targetUrl: null }
      ]
    })
    expect(brief).toContain('Page to improve: listed under each search')
    expect(brief).toContain('  Page to improve: https://textbolt.com/a/')
    expect(brief).toContain('  Page to improve: none yet (write a new page)')
  })
})
