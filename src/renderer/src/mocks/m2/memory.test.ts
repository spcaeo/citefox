import { describe, expect, test } from 'vitest'
import {
  ACME_FOUND,
  ACME_WORKING,
  FIELDPRO_FOUND,
  FIELDPRO_WORKING,
  TEXTBOLT_FOUND,
  TEXTBOLT_WORKING,
  textboltCatalog
} from './catalog'
import { createProjectMemory } from './memory'
import { trackedFoundTotals } from '../../projects/listModel'

describe('textbolt catalog', () => {
  test('matches the projects glance counts', () => {
    const projects = textboltCatalog().projects.map((project) => project.detail)
    expect(projects.map((project) => project.trackedPageCount)).toEqual([
      TEXTBOLT_WORKING,
      ACME_WORKING,
      FIELDPRO_WORKING
    ])
    expect(projects.map((project) => project.foundPageCount)).toEqual([
      TEXTBOLT_FOUND,
      ACME_FOUND,
      FIELDPRO_FOUND
    ])
    expect(trackedFoundTotals(projects)).toEqual({ tracked: 240, found: 2489 })
  })
})

describe('project memory', () => {
  test('lists working pages, searches the rest, and keeps pin order', () => {
    const memory = createProjectMemory(textboltCatalog())
    const listed = memory.listPages('textbolt')
    expect(listed.foundPageCount).toBe(TEXTBOLT_FOUND)
    expect(listed.pages).toHaveLength(TEXTBOLT_WORKING)
    expect(listed.pages.every((page) => page.status !== 'not_tracked')).toBe(true)
    expect(memory.pinned('textbolt').pages.map((page) => page.id)).toEqual([
      'alerts',
      'bulk',
      'optin'
    ])

    const blank = memory.searchPages({ projectId: 'textbolt', query: '   ' })
    expect(blank.pages).toEqual([])
    expect(blank.foundPageCount).toBe(TEXTBOLT_FOUND)

    const found = memory.searchPages({ projectId: 'textbolt', query: 'opt-in' })
    expect(found.pages.map((page) => page.id)).toEqual(['optin'])

    const untracked = memory.searchPages({ projectId: 'textbolt', query: 'not tracked' })
    expect(untracked.pages.length).toBe(0)
    const broad = memory.searchPages({ projectId: 'textbolt', query: 'textbolt.com/legal/' })
    expect(broad.pages.some((page) => page.status === 'not_tracked')).toBe(true)
  })

  test('create switches, add page uses the default market, and remove unpins', () => {
    const memory = createProjectMemory(textboltCatalog())
    const created = memory.create({
      name: 'Northwind',
      domain: 'northwind.example',
      includeSubdomains: true,
      brandNames: ['Northwind'],
      competitors: [],
      clientName: 'Northwind Dental',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop'
    })
    expect(memory.list().activeProjectId).toBe(created.id)
    expect(created.dbPath.startsWith('projects/')).toBe(true)

    const added = memory.addPage({
      projectId: 'textbolt',
      url: 'https://textbolt.com/blog/new-page/',
      markets: [],
      intervalDays: 14,
      samples: 1,
      promptCount: 4
    })
    expect(added.markets).toHaveLength(1)
    expect(added.markets[0]?.country).toBe('US')
    expect(added.status).toBe('setting_up')

    const removed = memory.removePage('textbolt', 'alerts')
    expect(removed.status).toBe('removed')
    expect(memory.getPage('textbolt', 'alerts').status).toBe('removed')
    expect(memory.pinned('textbolt').pages.map((page) => page.id)).toEqual(['bulk', 'optin'])
    expect(memory.listPages('textbolt').pages.some((page) => page.id === 'alerts')).toBe(false)
  })

  test('sample data has no secrets', () => {
    const memory = createProjectMemory(textboltCatalog())
    const blob = JSON.stringify({
      catalog: textboltCatalog(),
      list: memory.list(),
      pages: memory.listPages('textbolt'),
      pinned: memory.pinned('textbolt'),
      fill: memory.fill('textbolt.com')
    })
    expect(blob).not.toMatch(/sk-|api[_-]?key|secret|password|token/i)
    expect(blob).not.toContain('resolvedModel')
  })
})
