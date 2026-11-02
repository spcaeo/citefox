import { describe, expect, test } from 'vitest'
import type { TopicRowState } from './domain'
import {
  fixForSource,
  fixKindOf,
  opaqueId,
  pageFixCount,
  rollupPageFixes,
  type FixSearch
} from './page-fixes'

const T = 'https://textbolt.com/integration/nagios'
const OTHER = 'https://textbolt.com/blog/nagios-setup/'

let next = 0
function search(
  state: TopicRowState,
  extra: Partial<FixSearch> = {},
  odds: number | null = 50
): FixSearch {
  next += 1
  const sourceId = extra.sourceId ?? 'topic-a'
  return {
    id: `${sourceId}|p${next}`,
    sourceKind: 'topic',
    sourceId,
    sourceName: sourceId === 'topic-a' ? 'Nagios alerts' : 'School texts',
    promptId: `p${next}`,
    marketId: 'm1',
    runId: 'r1',
    label: `Q${next}`,
    kind: 'question',
    text: `Search ${next}`,
    state,
    targetPageId: null,
    targetUrl: state === 'no_page' ? null : T,
    citedOwnUrl: state === 'other_page' ? OTHER : state === 'right_page' ? T : null,
    citedInstead: ['reddit.com'],
    winOdds: odds === null ? null : { score: odds, level: 'medium', reason: '' },
    checkedAt: '2026-10-29T10:00:00.000Z',
    ...extra
  }
}

describe('fixKindOf', () => {
  test('maps each result to its page fix, or none', () => {
    expect(fixKindOf({ state: 'not_cited', targetUrl: T })).toBe('improve')
    expect(fixKindOf({ state: 'not_cited', targetUrl: null })).toBe('new')
    expect(fixKindOf({ state: 'no_page', targetUrl: null })).toBe('new')
    expect(fixKindOf({ state: 'other_page', targetUrl: T })).toBe('owner')
    expect(fixKindOf({ state: 'right_page', targetUrl: T })).toBeNull()
    expect(fixKindOf({ state: 'no_aio', targetUrl: T })).toBeNull()
    expect(fixKindOf({ state: 'failed', targetUrl: T })).toBeNull()
  })
})

describe('rollupPageFixes', () => {
  const searches = [
    search('not_cited', {}, 74),
    search('not_cited', { targetUrl: `${T}/` }, 60),
    search(
      'not_cited',
      { sourceId: 'topic-b', targetUrl: 'https://www.textbolt.com/integration/nagios' },
      80
    ),
    search('other_page', {}, 77),
    search('other_page', {}, 40),
    search('no_page', { sourceId: 'topic-b' }, 52),
    search('no_page', { sourceId: 'topic-b' }, null),
    search('no_page', {}, 30),
    search('right_page'),
    search('right_page'),
    search('no_aio', {}, null),
    search('failed', {}, null),
    search('not_checked', {}, null)
  ]
  const rollup = rollupPageFixes(searches)

  test('the parts add up to every search', () => {
    expect(rollup.total).toBe(searches.length)
    expect(
      rollup.needWork + rollup.targetCited.length + rollup.noAio.length + rollup.notChecked.length
    ).toBe(rollup.total)
    const inFixes = rollup.fixes.reduce((sum, fix) => sum + fix.searches.length, 0)
    expect(inFixes).toBe(rollup.needWork)
  })

  test('one target page is one fix, whatever the slash, www or topic', () => {
    const improve = rollup.fixes.filter((fix) => fix.kind === 'improve')
    expect(improve).toHaveLength(1)
    expect(improve[0]?.searches).toHaveLength(3)
    expect(improve[0]?.sources.map((source) => source.name)).toEqual([
      'Nagios alerts',
      'School texts'
    ])
    expect(improve[0]?.bestOdds).toBe(80)
    expect(improve[0]?.avgOdds).toBe(71)
    expect(improve[0]?.searches.map((item) => item.winOdds?.score)).toEqual([80, 74, 60])
  })

  test('an owner fix names the page cited instead; a new page is one per topic', () => {
    const owner = rollup.fixes.find((fix) => fix.kind === 'owner')
    expect(owner?.citedUrl).toBe(OTHER)
    expect(owner?.page?.url).toBe(T)
    const created = rollup.fixes.filter((fix) => fix.kind === 'new')
    expect(created.map((fix) => [fix.proposed, fix.searches.length])).toEqual([
      ['School texts', 2],
      ['Nagios alerts', 1]
    ])
    expect(created.every((fix) => fix.page === null)).toBe(true)
  })

  test('fixes come grouped by kind, most searches first', () => {
    expect(rollup.fixes.map((fix) => fix.kind)).toEqual(['improve', 'owner', 'new', 'new'])
    expect(rollup.byKind).toEqual({
      improve: { fixes: 1, searches: 3 },
      owner: { fixes: 1, searches: 2 },
      new: { fixes: 2, searches: 3 }
    })
    expect(pageFixCount(searches)).toBe(4)
  })

  test('ids are opaque and stable', () => {
    const again = rollupPageFixes([...searches].reverse())
    expect(again.fixes.map((fix) => fix.id).sort()).toEqual(
      rollup.fixes.map((fix) => fix.id).sort()
    )
    for (const fix of rollup.fixes) {
      expect(fix.id).toMatch(/^pf[0-9a-z]+$/)
      expect(fix.id).not.toContain('textbolt')
    }
    expect(opaqueId('a')).not.toBe(opaqueId('b'))
  })

  test('a topic filter keeps its searches only, and still adds up', () => {
    const b = rollupPageFixes(searches, 'topic-b')
    expect(b.total).toBe(3)
    expect(b.needWork).toBe(3)
    expect(b.fixes.map((fix) => fix.kind)).toEqual(['improve', 'new'])
  })

  test('fixForSource cuts a fix to one topic', () => {
    const improve = rollup.fixes[0]
    if (!improve) throw new Error('no fix')
    const cut = fixForSource(improve, 'topic-b')
    expect(cut.searches).toHaveLength(1)
    expect(cut.sources).toEqual([
      { id: 'topic-b', kind: 'topic', name: 'School texts', searches: 1 }
    ])
    expect(cut.bestOdds).toBe(80)
    expect(cut.id).toBe(improve.id)
  })

  test('no searches: an empty rollup', () => {
    const empty = rollupPageFixes([])
    expect(empty.total).toBe(0)
    expect(empty.fixes).toEqual([])
  })
})
