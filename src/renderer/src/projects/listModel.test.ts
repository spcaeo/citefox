import { describe, expect, test } from 'vitest'
import { textboltCatalog } from '../mocks/m2/catalog'
import {
  activeSummary,
  filterProjectDetails,
  projectFacetCount,
  projectsForSwitcher,
  sortProjectDetails
} from './listModel'

const projects = textboltCatalog().projects.map((project) => project.detail)

describe('project list model', () => {
  test('hides archived projects from the switcher and counts facets', () => {
    const first = projects[0]
    if (!first) throw new Error('sample project missing')
    const archived = { ...first, id: 'old', status: 'archived' as const }
    const all = [...projects, archived]
    expect(projectsForSwitcher(all).map((project) => project.id)).toEqual([
      'textbolt',
      'acme',
      'fieldpro'
    ])
    expect(activeSummary(projects)).toBe('2 active · 1 paused')
    expect(projectFacetCount(projects, '', { statuses: [], clients: [] }, 'client', 'Client')).toBe(
      2
    )
    expect(
      filterProjectDetails(projects, 'field', { statuses: ['Paused'], clients: [] }).map(
        (project) => project.id
      )
    ).toEqual(['fieldpro'])
    expect(sortProjectDetails(projects, 'tracked', 'desc')[0]?.id).toBe('textbolt')
  })
})
