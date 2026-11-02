import { describe, expect, test } from 'vitest'
import type { ProjectScoreSummary } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { textboltCatalog } from '../../../mocks/m2/catalog'
import {
  ariaSort,
  nextSorts,
  projectMarketLabels,
  rowSearches,
  sortButtonLabel,
  sortProjectRows,
  type ProjectRow
} from './rows'

const projects = textboltCatalog().projects.map((project) => project.detail)

function score(projectId: string, averageScore: number | null, used = 0): ProjectScoreSummary {
  return {
    projectId,
    averageScore,
    change: null,
    nextCheckAt: null,
    searchesUsed: used,
    searchCap: null,
    pagesDueToday: 0
  }
}

function rows(scores: Record<string, ProjectScoreSummary>): ProjectRow[] {
  return projects.map((project) => ({
    project,
    score: scores[project.id],
    schedule: undefined,
    usage: undefined
  }))
}

describe('Projects table rows (FR-10.5)', () => {
  test('sorts by score with missing scores last in both directions', () => {
    const list = rows({
      textbolt: score('textbolt', 41),
      fieldpro: score('fieldpro', 35)
    })
    expect(sortProjectRows(list, [{ key: 'score', dir: 'desc' }]).map((r) => r.project.id)).toEqual(
      ['textbolt', 'fieldpro', 'acme']
    )
    expect(sortProjectRows(list, [{ key: 'score', dir: 'asc' }]).map((r) => r.project.id)).toEqual([
      'fieldpro',
      'textbolt',
      'acme'
    ])
  })

  test('a second sort breaks ties of the first', () => {
    const list = rows({})
    const sorted = sortProjectRows(list, [
      { key: 'kind', dir: 'asc' },
      { key: 'name', dir: 'desc' }
    ])
    expect(sorted.map((row) => row.project.id)).toEqual(['fieldpro', 'acme', 'textbolt'])
  })

  test('header clicks flip, replace, and Shift-click adds a sort', () => {
    let sorts = nextSorts([], 'name', false)
    expect(sorts).toEqual([{ key: 'name', dir: 'asc' }])
    sorts = nextSorts(sorts, 'name', false)
    expect(sorts).toEqual([{ key: 'name', dir: 'desc' }])
    sorts = nextSorts(sorts, 'tracked', true)
    expect(sorts).toEqual([
      { key: 'name', dir: 'desc' },
      { key: 'tracked', dir: 'asc' }
    ])
    expect(ariaSort(sorts, 'tracked')).toBe('ascending')
    expect(ariaSort(sorts, 'status')).toBe('none')
    expect(sortButtonLabel(sorts, 'status')).toBe('Sort by Status')
    expect(nextSorts(sorts, 'status', false)).toEqual([{ key: 'status', dir: 'asc' }])
  })

  test('lists every market, default first, and falls back to the default market', () => {
    const base = projects[0] as ProjectDetail
    const us = base.defaultMarket
    if (!us) throw new Error('sample market missing')
    const uk = { ...us, id: 'uk', country: 'UK' }
    expect(projectMarketLabels({ ...base, markets: [us, uk] })).toEqual([
      '🇺🇸 US · EN',
      '🇬🇧 UK · EN'
    ])
    expect(projectMarketLabels({ ...base, markets: undefined })).toEqual(['🇺🇸 US · EN'])
  })

  test('searches come from the score summary, and the usage report before scores load', () => {
    const project = projects[0] as ProjectDetail
    const row: ProjectRow = {
      project,
      score: score(project.id, 10, 7),
      schedule: undefined,
      usage: undefined
    }
    expect(rowSearches(row)).toEqual({ used: 7, cap: null })
    expect(
      rowSearches({
        ...row,
        score: undefined,
        usage: {
          projectId: project.id,
          name: project.name,
          clientName: null,
          status: 'active',
          source: 'shared',
          searches: 9,
          sharedSearches: 9,
          cap: 100,
          capRule: 'pause',
          allowance: 100,
          dedicatedKeyId: null,
          sharePercent: 2,
          claudeCalls: 0,
          claudeLabel: 'CiteFox AI'
        }
      })
    ).toEqual({ used: 9, cap: 100 })
  })
})
