import { describe, expect, it } from 'vitest'
import { REPORT_SECTIONS, SECTION_TITLES } from './build'
import {
  groupOfSection,
  groupTabs,
  MAX_PLAIN_TABS,
  TAB_GROUPS,
  type ReportSectionEntry
} from './tab-groups'
import { REPORT_KINDS, type ReportKind, type ReviewSectionId } from './types'

function entries(
  ids: readonly ReviewSectionId[],
  empty: readonly ReviewSectionId[] = []
): ReportSectionEntry[] {
  return ids.map((id) => ({
    id,
    title: SECTION_TITLES[id],
    ...(empty.includes(id) ? { empty: 'Needs more.' } : {})
  }))
}

describe('grouped tabs', () => {
  it('every map holds each of its report sections exactly once', () => {
    for (const kind of REPORT_KINDS) {
      const map = TAB_GROUPS[kind]
      if (map === undefined) continue
      const ids = map.flatMap((group) => group.sections)
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual([...REPORT_SECTIONS[kind]].sort())
      expect(map.length).toBeLessThanOrEqual(MAX_PLAIN_TABS + 1)
      expect(map.at(-1)).toMatchObject({ id: 'method', quiet: true })
    }
  })

  it('groups the Visibility report and the Impact review as the mock-up', () => {
    const vis = groupTabs('visibility', entries(REPORT_SECTIONS.visibility))
    expect(vis.map((group) => group.title)).toEqual([
      'Overview',
      'Questions',
      'Competitors',
      'Pages',
      'Content',
      'Reputation & sources',
      'How we measured'
    ])
    expect(vis[4]?.sections.map((entry) => entry.id)).toEqual(['topics', 'shape', 'deep'])
    const impact = groupTabs('impact', entries(REPORT_SECTIONS.impact))
    expect(impact.map((group) => group.title)).toEqual([
      'Verdict',
      'Published pages',
      'Questions',
      'Competitors',
      'Pages',
      'Client asks',
      'More',
      'How we measured'
    ])
    const changed = groupTabs('changed', entries(REPORT_SECTIONS.changed))
    expect(changed.length).toBeLessThanOrEqual(MAX_PLAIN_TABS)
  })

  it('finds the group of an old section link, and the first tab for an unknown one', () => {
    const groups = groupTabs('visibility', entries(REPORT_SECTIONS.visibility))
    expect(groupOfSection(groups, 'topics')?.id).toBe('g-content')
    expect(groupOfSection(groups, 'backlinks')?.title).toBe('Reputation & sources')
    expect(groupOfSection(groups, 'verdict')?.id).toBe('standing')
  })

  it('drops a group whose sections are all hidden and greys one whose sections are all empty', () => {
    const shown = REPORT_SECTIONS.impact.filter(
      (id) => !['notindexed', 'backlinks', 'next'].includes(id)
    )
    const groups = groupTabs('impact', entries(shown, ['changed', 'topics', 'deep']))
    expect(groups.map((group) => group.title)).not.toContain('Client asks')
    const more = groups.find((group) => group.title === 'More')
    expect(more?.empty).toBe(true)
    expect(more?.hint).toBeDefined()
    expect(groups.find((group) => group.title === 'Pages')?.empty).toBe(false)
  })

  it('shows plain tabs with no map or with 7 or fewer sections', () => {
    const few = groupTabs('impact', entries(['verdict', 'pages', 'lost', 'method']))
    expect(few.map((group) => group.id)).toEqual(['verdict', 'pages', 'lost', 'method'])
    expect(few.every((group) => group.sections.length === 1 && !group.quiet)).toBe(true)
    const unmapped = groupTabs('pitch' as ReportKind, entries(REPORT_SECTIONS.impact))
    expect(unmapped).toHaveLength(REPORT_SECTIONS.impact.length)
  })

  it('a section the map does not know gets its own tab before How we measured', () => {
    const map = TAB_GROUPS.changed ?? []
    const known = map.flatMap((group) => group.sections)
    const extra: ReviewSectionId = 'reputation'
    expect(known).not.toContain(extra)
    const groups = groupTabs('changed', entries([...REPORT_SECTIONS.changed, extra]))
    expect(groups.at(-2)?.id).toBe(extra)
    expect(groups.at(-1)?.id).toBe('method')
  })

  it('every top row fits one line at a 1260 px window with the sidebar open', () => {
    // 1260 − 220 sidebar − 2 × 32 page padding; 8 px a character at 14 px (generous),
    // a 20 px gap, and room for an alert dot on every tab.
    const room = 1260 - 220 - 64
    for (const kind of REPORT_KINDS) {
      const groups = groupTabs(kind, entries(REPORT_SECTIONS[kind]))
      const width = groups.reduce((sum, group) => sum + group.title.length * 8 + 20 + 24, 0)
      expect(width, kind).toBeLessThanOrEqual(room)
    }
  })
})
