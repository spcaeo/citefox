import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import type { StatusCapsule } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import {
  EMPTY_SCORE,
  filterProjects,
  formatScore,
  marketCountTag,
  marketLabel,
  nextTabIndex,
  pageDetailTags,
  pageSearchPlaceholder,
  projectMenuDetail,
  projectMenuLabel,
  projectStatusLabel,
  setupStepsLabel,
  statusButtonTip,
  statusCapsuleDots,
  statusCapsuleLabel,
  statusIssueCount,
  showYoutubeDot,
  tabIndexFor
} from './model'

describe('nextTabIndex', () => {
  test('wraps with the arrow keys and jumps with Home and End', () => {
    expect(nextTabIndex(0, 9, 'ArrowLeft')).toBe(8)
    expect(nextTabIndex(8, 9, 'ArrowRight')).toBe(0)
    expect(nextTabIndex(3, 9, 'ArrowRight')).toBe(4)
    expect(nextTabIndex(4, 9, 'Home')).toBe(0)
    expect(nextTabIndex(0, 9, 'End')).toBe(8)
    expect(nextTabIndex(2, 9, 'Enter')).toBeNull()
    expect(nextTabIndex(0, 0, 'Home')).toBeNull()
  })

  test('finds a tab by id', () => {
    expect(tabIndexFor('results')).toBe(0)
    expect(tabIndexFor('history')).toBe(8)
  })
})

const SAMPLE_PROJECTS = textboltCatalog().projects.map((project) => project.detail)

describe('project switcher search', () => {
  test('matches name, domain, and client, and ignores surrounding space', () => {
    expect(filterProjects(SAMPLE_PROJECTS, '  ').map((project) => project.id)).toEqual([
      'textbolt',
      'acme',
      'fieldpro'
    ])
    expect(filterProjects(SAMPLE_PROJECTS, 'TEXT').map((project) => project.id)).toEqual([
      'textbolt'
    ])
    expect(filterProjects(SAMPLE_PROJECTS, 'acmeclinics.com').map((project) => project.id)).toEqual(
      ['acme']
    )
    expect(filterProjects(SAMPLE_PROJECTS, 'fieldpro hvac').map((project) => project.id)).toEqual([
      'fieldpro'
    ])
    expect(filterProjects(SAMPLE_PROJECTS, 'client').map((project) => project.id)).toEqual([
      'acme',
      'fieldpro'
    ])
    expect(filterProjects(SAMPLE_PROJECTS, 'nope')).toEqual([])
  })

  test('labels client projects and their status the way the menu does', () => {
    const textbolt = SAMPLE_PROJECTS[0]
    const acme = SAMPLE_PROJECTS[1]
    const fieldpro = SAMPLE_PROJECTS[2]
    if (!textbolt || !acme || !fieldpro) throw new Error('sample projects missing')
    expect(projectMenuLabel(textbolt)).toBe('TextBolt')
    expect(projectMenuLabel(acme)).toBe('Acme Clinics (client)')
    expect(projectMenuDetail({ ...acme, clientName: 'Acme Inc.', status: 'paused' })).toBe(
      `${acme.domain} · Client: Acme Inc. · Paused`
    )
    expect(projectMenuDetail(textbolt)).toBe(`${textbolt.domain} · Active`)
    expect(projectStatusLabel(textbolt.status)).toBe('Active')
    expect(projectStatusLabel(fieldpro.status)).toBe('Paused')
    expect(projectStatusLabel('archived')).toBe('Archived')
  })
})

describe('page chrome text', () => {
  test('formats scores, market counts, and the page search placeholder', () => {
    expect(formatScore(50)).toBe('50')
    expect(formatScore(null)).toBe(EMPTY_SCORE)
    expect(marketCountTag(1)).toBe('1 market')
    expect(marketCountTag(4)).toBe('4 markets')
    expect(pageSearchPlaceholder(0)).toBe('Search 0 pages')
    expect(pageSearchPlaceholder(1)).toBe('Search 1 page')
    expect(pageSearchPlaceholder(2)).toBe('Search 2 pages')
    expect(pageSearchPlaceholder(2014)).toBe('Search 2,014 pages')
  })

  test('derives market labels and page tags from shared fields', () => {
    const pages = textboltCatalog().projects[0]?.pages
    const alerts = pages?.find((page) => page.summary.id === 'alerts')
    const bulk = pages?.find((page) => page.summary.id === 'bulk')
    if (!alerts || !bulk) throw new Error('sample pages missing')
    expect(alerts.markets.map(marketLabel)).toEqual([
      '🇺🇸 US · EN',
      '🇺🇸 US · Austin · EN',
      '🇬🇧 UK · EN',
      '🇲🇽 MX · ES'
    ])
    const countries = new Set<string>()
    for (const project of textboltCatalog().projects) {
      if (project.detail.defaultMarket) countries.add(project.detail.defaultMarket.country)
      for (const page of project.pages) {
        for (const market of page.markets) countries.add(market.country)
      }
    }
    expect([...countries].sort()).toEqual(['CA', 'MX', 'UK', 'US'])
    expect(marketLabel({ country: 'CA', language: 'en', location: null })).toBe('🇨🇦 CA · EN')
    // Every country the market pickers offer gets its flag, not only the sample's.
    expect(marketLabel({ country: 'AU', language: 'en', location: null })).toBe('🇦🇺 AU · EN')
    expect(marketLabel({ country: 'IN', language: 'hi', location: null })).toBe('🇮🇳 IN · HI')
    expect(marketLabel({ country: 'UK', language: 'en', location: null })).toBe('🇬🇧 UK · EN')
    expect(marketLabel({ country: 'GB', language: 'en', location: null })).toBe('🇬🇧 GB · EN')
    expect(marketLabel({ country: 'X1', language: 'en', location: null })).toBe('X1 · EN')
    for (const country of countries) {
      expect(marketLabel({ country, language: 'en', location: null })).toMatch(
        /^\p{Regional_Indicator}{2}/u
      )
    }
    expect(
      pageDetailTags({
        markets: alerts.markets,
        intervalDays: alerts.summary.intervalDays,
        samples: alerts.summary.samples,
        promptSetVersion: alerts.summary.promptSetVersion,
        promptCount: alerts.summary.promptCount
      })
    ).toEqual([
      '4 markets',
      'Every 7 days',
      '1 sample per question',
      'Question set v2 · 10 questions'
    ])
    expect(
      pageDetailTags({
        markets: bulk.markets,
        intervalDays: bulk.summary.intervalDays,
        samples: bulk.summary.samples,
        promptSetVersion: bulk.summary.promptSetVersion,
        promptCount: bulk.summary.promptCount
      })
    ).toEqual(['1 market', 'Every 7 days', '1 sample per question'])
    expect(
      pageDetailTags({
        markets: bulk.markets,
        intervalDays: 1,
        samples: bulk.summary.samples,
        promptSetVersion: bulk.summary.promptSetVersion,
        promptCount: bulk.summary.promptCount
      })
    ).toContain('Every day')
  })
})

const STATUS_CONNECTIONS = {
  serpapi: 'ok',
  claudeCode: 'ok',
  jina: 'warning',
  youtube: 'unchecked'
} as const satisfies Pick<StatusCapsule, 'serpapi' | 'claudeCode' | 'jina' | 'youtube'>

const STATUS_CAPSULE: StatusCapsule = {
  searchesLeft: 3992,
  issueCount: statusIssueCount(STATUS_CONNECTIONS),
  ...STATUS_CONNECTIONS
}

const SHELL_KEYS: readonly ApiKeyMetadata[] = []

describe('status capsule', () => {
  test('counts warning states and keeps the Home sentence', () => {
    expect(statusIssueCount(STATUS_CAPSULE)).toBe(STATUS_CAPSULE.issueCount)
    expect(STATUS_CAPSULE.issueCount).toBe(1)
    expect(SHELL_KEYS).toEqual([])
    expect(showYoutubeDot(STATUS_CAPSULE.youtube, SHELL_KEYS)).toBe(false)
    expect(statusCapsuleDots(STATUS_CAPSULE, SHELL_KEYS)).toEqual(['ok', 'ok', 'warning'])
    expect(statusCapsuleLabel(STATUS_CAPSULE)).toBe('3,992 searches left · 1 issue')
    expect(statusButtonTip(STATUS_CAPSULE)).toBe('3,992 searches left this month · 1 issue')
    expect(statusButtonTip(STATUS_CAPSULE, { steps: 1, issues: 0 })).toBe(
      '3,992 searches left this month · Setup: 1 step left'
    )
    expect(statusButtonTip({ searchesLeft: null, issueCount: 0 }, { steps: 2, issues: 1 })).toBe(
      'Setup: 2 steps left · 1 issue'
    )
    expect(statusButtonTip({ searchesLeft: 12, issueCount: 0 })).toBe(
      '12 searches left this month · Setup done'
    )
    expect(setupStepsLabel({ steps: 0 })).toBeNull()
    expect(setupStepsLabel({ steps: 3 })).toBe('Setup: 3 steps left')
    expect(statusCapsuleLabel({ searchesLeft: null, issueCount: 0 })).toBe('0 issues')
  })

  test('shows the YouTube dot once a key exists and still counts every warning', () => {
    const youtubeKey: ApiKeyMetadata = {
      id: 'yt-1',
      provider: 'youtube',
      name: 'YouTube',
      keychainRef: 'keys/youtube',
      hint: '4f2a',
      rotationOrder: 0,
      cap: null,
      on: true,
      projectIds: [],
      state: 'unchecked',
      lastReason: null,
      serpapiUsage: null
    }
    expect(showYoutubeDot('unchecked', [youtubeKey])).toBe(true)
    expect(statusCapsuleDots(STATUS_CAPSULE, [youtubeKey])).toEqual([
      'ok',
      'ok',
      'warning',
      'unchecked'
    ])
    expect(statusIssueCount({ ...STATUS_CAPSULE, youtube: 'unchecked' })).toBe(1)
    const withWarning = { ...STATUS_CAPSULE, youtube: 'warning' as const }
    expect(statusIssueCount(withWarning)).toBe(2)
    expect(showYoutubeDot('unchecked', [{ provider: 'serpapi' }])).toBe(false)
    expect(showYoutubeDot('off', [])).toBe(false)
  })
})
