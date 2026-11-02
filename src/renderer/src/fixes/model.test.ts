import { describe, expect, it } from 'vitest'
import type { GapSuggestion, ProjectFix } from '@shared/ipc'
import { fix } from '../progress/fixtures'
import {
  costLine,
  filterFixes,
  fixDetailHash,
  fixName,
  fixStage,
  gapHash,
  isStageFilter,
  pathOf,
  stageCounts
} from './model'

const item = (over: Parameters<typeof fix>[0]): ProjectFix => ({
  fix: fix(over),
  searchesMin: 3,
  searchesMax: 6
})

describe('fixes model', () => {
  it('maps a fix status to a stage and counts each', () => {
    const items = [
      item({ id: 'a', status: 'planned' }),
      item({ id: 'b', status: 'started' }),
      item({ id: 'c', status: 'completed', pageId: 'page-2' })
    ]
    expect(items.map((entry) => fixStage(entry.fix))).toEqual(['open', 'checking', 'done'])
    expect(stageCounts(items)).toEqual({ all: 3, open: 1, checking: 1, done: 1 })
    expect(filterFixes(items, 'done', null).map((entry) => entry.fix.id)).toEqual(['c'])
    expect(filterFixes(items, 'all', 'page-1').map((entry) => entry.fix.id)).toEqual(['a', 'b'])
    expect(isStageFilter('checking')).toBe(true)
    expect(isStageFilter('nope')).toBe(false)
    expect(isStageFilter(null)).toBe(false)
  })

  it('says the cost and names the fix in one line', () => {
    expect(costLine({ searchesMin: 4, searchesMax: 8 })).toBe('Uses about 4–8 searches')
    expect(costLine({ searchesMin: 1, searchesMax: 1 })).toBe('Uses about 1 search')
    expect(fixName(fix({ number: 3, description: 'Add a **price** table\nmore' }))).toBe(
      'Fix 3 · Add a price table'
    )
    expect(fixName(fix({ number: 4, description: 'x'.repeat(80) }))).toHaveLength(
      'Fix 4 · '.length + 60
    )
  })

  it('links a fix and a gap to their page or topic', () => {
    const page = { id: 'page-1', kind: 'page' as const, label: 'Pricing', url: 'https://a.com/p/' }
    const topic = { id: 'topic-1', kind: 'topic' as const, label: 'Gateways', url: null }
    expect(fixDetailHash(page, fix({ number: 2 }))).toBe('#/pages/page-1/progress?filter=fix%3A2')
    expect(fixDetailHash(topic, fix({ pageId: 'topic-1' }))).toContain('topic-1')
    const gap = { pageId: 'page-1', promptId: 'p7' } as GapSuggestion
    expect(gapHash(page, gap)).toBe('#/pages/page-1/gaps?filter=row%3Ap7')
    expect(pathOf('https://a.com/pricing/?x=1')).toBe('/pricing/?x=1')
    expect(pathOf('not a url')).toBe('not a url')
  })
})
