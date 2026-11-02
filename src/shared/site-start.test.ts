import { describe, expect, test } from 'vitest'
import type { SiteStartBudget, SiteStartPage, StartJourney } from './ipc'
import {
  clockText,
  defaultTargetUrls,
  estimateFirstCheck,
  etaText,
  journeyReached,
  searchRangeText,
  START_RECOMMENDED_PAGES
} from './site-start'

const BUDGET: SiteStartBudget = {
  markets: 1,
  promptsPerPage: 10,
  questionsPerTopic: 10,
  samples: 1,
  searchesLeft: 212
}

function page(url: string, alreadyTracked = false): SiteStartPage {
  return {
    url,
    path: new URL(url).pathname,
    title: null,
    pageId: null,
    kind: 'other',
    section: 'Top-level pages',
    reason: 'r',
    evidence: 'e',
    alreadyTracked,
    questionCount: 0
  }
}

describe('estimateFirstCheck', () => {
  test('questions × markets × samples, 1–2 searches each; target pages add none', () => {
    expect(estimateFirstCheck(BUDGET, 10)).toEqual({
      questions: 10,
      minSearches: 10,
      maxSearches: 20,
      searchesLeft: 212,
      fits: true,
      leftAfter: 202
    })
  })

  test('the high end decides whether it fits', () => {
    expect(estimateFirstCheck({ ...BUDGET, searchesLeft: 15 }, 10).fits).toBe(false)
    expect(estimateFirstCheck({ ...BUDGET, markets: 2, samples: 2 }, 10).maxSearches).toBe(80)
  })

  test('an unknown allowance gives null; bad counts count as zero', () => {
    const none = estimateFirstCheck({ ...BUDGET, searchesLeft: null }, Number.NaN)
    expect(none).toMatchObject({ questions: 0, minSearches: 0, fits: null, leftAfter: null })
  })
})

describe('defaultTargetUrls', () => {
  test('the recommended pages that are still in the plan, at most three', () => {
    const pages = ['a', 'b', 'c', 'd'].map((slug) => page(`https://x.com/${slug}/`))
    expect(
      defaultTargetUrls({
        pages,
        recommendedUrls: ['https://x.com/d/', 'https://x.com/gone/', 'https://x.com/a/']
      })
    ).toEqual(['https://x.com/d/', 'https://x.com/a/'])
  })

  test('without recommendations, the first pages', () => {
    const pages = ['a', 'b', 'c', 'd'].map((slug) => page(`https://x.com/${slug}/`))
    expect(defaultTargetUrls({ pages, recommendedUrls: [] })).toHaveLength(START_RECOMMENDED_PAGES)
  })
})

describe('journeyReached', () => {
  const base: StartJourney = {
    projectId: 'p',
    empty: true,
    running: false,
    hasPlan: false,
    topicId: null,
    checkStarted: false,
    hasResults: false,
    resultsPageId: null
  }
  test('read → found → check → results', () => {
    expect(journeyReached(null)).toBe('read')
    expect(journeyReached(base)).toBe('read')
    expect(journeyReached({ ...base, hasPlan: true })).toBe('found')
    expect(journeyReached({ ...base, hasPlan: true, checkStarted: true })).toBe('check')
    expect(journeyReached({ ...base, hasPlan: true, hasResults: true })).toBe('results')
  })
})

test('copy helpers', () => {
  expect(searchRangeText({ minSearches: 10, maxSearches: 20 })).toBe('10–20 searches')
  expect(searchRangeText({ minSearches: 0, maxSearches: 0 })).toBe('0 searches')
  expect(clockText(64_000)).toBe('1:04')
  expect(etaText(8)).toBe('about 8 s left')
  expect(etaText(95)).toBe('about 2 min left')
  expect(etaText(null)).toBeNull()
})
