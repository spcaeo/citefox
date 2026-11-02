import { describe, expect, test } from 'vitest'
import { rollupPageFixes } from '@shared/page-fixes'
import { fixSearches, projectSearches } from '../searchFixtures'
import {
  fixDrill,
  fixTitle,
  kindFilter,
  leadLine,
  openGroups,
  sourcesLabel,
  todoGroups,
  toggleGroup
} from './model'

const data = projectSearches()
const rollup = rollupPageFixes(data.searches)

describe('What to fix model', () => {
  test('the story rolls up into one fix per page, of every kind', () => {
    expect(rollup.fixes.map((fix) => [fix.kind, fixTitle(fix), fix.searches.length])).toEqual([
      ['improve', '/integration/nagios-email-to-text-alerts', 4],
      ['improve', '/pricing', 2],
      ['owner', '/blog/nagios-setup/', 2],
      ['new', 'New page: School emergency texts', 3]
    ])
    expect(rollup.total).toBe(fixSearches().length)
  })

  test('by kind: one group per kind with its short line', () => {
    const groups = todoGroups(rollup, 'kind', data.sources, null)
    expect(groups.map((group) => [group.label, group.fixes.length, group.searches])).toEqual([
      ['Improve a page', 2, 6],
      ['Pick which page owns it', 1, 2],
      ['Write a new page', 1, 3]
    ])
    expect(groups[0]?.todo).toBe('the page exists, Google picks others')
  })

  test('by topic: each topic lists its own cut of the fixes, and the groups add up', () => {
    const groups = todoGroups(rollup, 'topic', data.sources, null)
    expect(groups.map((group) => [group.key, group.searches])).toEqual([
      ['topic-nagios', 6],
      ['topic-school', 3],
      ['page-pricing', 2]
    ])
    expect(groups.reduce((sum, group) => sum + group.searches, 0)).toBe(rollup.needWork)
  })

  test('by page: one flat list, most searches first; a kind filter keeps that kind', () => {
    const [all] = todoGroups(rollup, 'page', data.sources, null)
    expect(all?.fixes.map((fix) => fix.searches.length)).toEqual([4, 3, 2, 2])
    const owners = todoGroups(rollup, 'kind', data.sources, 'owner')
    expect(owners.map((group) => group.key)).toEqual(['owner'])
  })

  test('lines say what needs work and add up', () => {
    expect(leadLine(rollup)).toBe(
      '11 searches need work. We grouped them by page, so you fix 4 pages, not 11 searches.'
    )
    expect(leadLine(rollupPageFixes([]))).toMatch(/No searches checked yet/)
  })

  test('labels, filters and toggles', () => {
    const improve = rollup.fixes[0]
    if (!improve) throw new Error('no fix')
    expect(sourcesLabel(improve)).toBe('Nagios and monitoring alerts')
    expect(kindFilter('owner')).toBe('owner')
    expect(kindFilter('nope')).toBeNull()
    expect(toggleGroup(null, 'improve')).toBe('improve')
    expect(toggleGroup('improve', 'improve')).toBeNull()
    expect([...openGroups('a,b')]).toEqual(['a', 'b'])
  })

  test("a fix's drill lists exactly its searches, with prompt links", () => {
    const fix = rollup.fixes[0]
    if (!fix) throw new Error('no fix')
    const drill = fixDrill(fix, 'proj-1', 'textbolt.com')
    expect(drill.items).toHaveLength(fix.searches.length)
    expect(drill.items[0]).toMatchObject({
      primary: 'Nagios and monitoring alerts search 1',
      cells: { result: 'Not cited', odds: 74 },
      target: { kind: 'prompt', pageId: 'topic-nagios', promptId: 'nagios-p1' }
    })
    expect(drill.id).toBe(`fix:${fix.id}`)
  })
})
