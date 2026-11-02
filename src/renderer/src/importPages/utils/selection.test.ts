import { describe, expect, it } from 'vitest'
import type { ImportCandidate } from '@shared/ipc'
import { EMPTY_SELECTION } from '../constants'
import type { SelectionState } from '../types'
import { estimateFormula, estimateNotes } from './estimate'
import { formatLastmod } from './preview'
import {
  displayTitle,
  fileRowsCsv,
  isRecent,
  mergePool,
  previewRows,
  quickPickCount,
  rowKey,
  ruleMatchCount,
  selectedRows,
  trackPayload
} from './selection'

const NOW = Date.parse('2026-10-20T12:00:00.000Z')

function row(path: string, patch: Partial<ImportCandidate> = {}): ImportCandidate {
  const folderPart = path.split('/').filter(Boolean)
  return {
    pageId: `page${path.replace(/[^a-z0-9]+/gi, '-')}`,
    url: `https://textbolt.com${path}`,
    path,
    title: null,
    folder: folderPart.length >= 2 ? `/${folderPart[0]}/` : '/',
    clusterId: null,
    clusterName: null,
    lastmod: '2026-01-02',
    internalLinks: null,
    moneyPage: false,
    alreadyTracked: false,
    needsSetup: true,
    status: 'not_tracked',
    ...patch
  }
}

const POOL: ImportCandidate[] = [
  row('/blog/10dlc-registration-guide/', { clusterId: 'c1', clusterName: '10DLC & compliance' }),
  row('/blog/email-to-sms/', { lastmod: '2026-10-01' }),
  row('/features/bulk-sms/', { moneyPage: true, alreadyTracked: true, status: 'tracked' }),
  row('/compare/simpletexting/', { moneyPage: true, title: 'TextBolt vs SimpleTexting' }),
  row('/pricing/', { moneyPage: true, lastmod: '2026-10-18T09:00:00Z' })
]

function state(patch: Partial<SelectionState>): SelectionState {
  return { ...EMPTY_SELECTION, ...patch }
}

describe('import selection model', () => {
  it('derives a readable title from the slug when the page was never read', () => {
    expect(displayTitle(row('/blog/how-to-set-up-text-alerts/'))).toBe('How to set up text alerts')
    expect(displayTitle(row('/'))).toBe('Home page')
    expect(displayTitle(row('/compare/x/', { title: 'Real title' }))).toBe('Real title')
  })

  it('adds folders, clusters, rules, and quick picks together, counting a page once', () => {
    const chosen = previewRows(
      POOL,
      state({
        folders: ['/blog/'],
        clusters: ['c1'],
        rules: [{ id: 1, op: 'contains', value: '/compare/' }],
        picks: { links: false, recent: false, money: true }
      }),
      NOW
    )
    expect(chosen.map((item) => item.path)).toEqual([
      '/blog/10dlc-registration-guide/',
      '/blog/email-to-sms/',
      '/features/bulk-sms/',
      '/compare/simpletexting/',
      '/pricing/'
    ])
    // The tracked page is shown but never counted as new.
    expect(selectedRows(chosen, []).map((item) => item.path)).not.toContain('/features/bulk-sms/')
  })

  it("lets a doesn't-contain rule remove pages from the union", () => {
    const chosen = previewRows(
      POOL,
      state({
        folders: ['/blog/'],
        rules: [{ id: 1, op: 'not_contains', value: '10dlc' }]
      }),
      NOW
    )
    expect(chosen.map((item) => item.path)).toEqual(['/blog/email-to-sms/'])
  })

  it('keeps unticked pages out of the selection', () => {
    const chosen = previewRows(POOL, state({ folders: ['/blog/'] }), NOW)
    const off = [rowKey(POOL[0]!)]
    expect(selectedRows(chosen, off).map((item) => item.path)).toEqual(['/blog/email-to-sms/'])
  })

  it('matches title rules and counts rule matches', () => {
    expect(ruleMatchCount({ id: 1, op: 'title', value: 'simpletexting' }, POOL)).toBe(1)
    expect(ruleMatchCount({ id: 1, op: 'starts', value: '/blog/' }, POOL)).toBe(2)
    expect(ruleMatchCount({ id: 1, op: 'contains', value: '  ' }, POOL)).toBe(0)
  })

  it('picks pages updated in the last 90 days by lastmod', () => {
    expect(isRecent('2026-10-01', NOW)).toBe(true)
    expect(isRecent('2026-01-02', NOW)).toBe(false)
    expect(isRecent('not a date', NOW)).toBe(false)
    expect(quickPickCount(POOL, 'recent', NOW)).toBe(2)
    expect(quickPickCount(POOL, 'money', NOW)).toBe(3)
    expect(quickPickCount(POOL, 'links', NOW)).toBe(0)
  })

  it('merges pasted rows and selects a pasted URL that is already a project page', () => {
    const pasted = [
      row('/blog/email-to-sms/', { pageId: null }),
      row('/new-page/', { pageId: null, status: null })
    ]
    const pool = mergePool(POOL, pasted)
    expect(pool).toHaveLength(POOL.length + 1)
    const chosen = previewRows(pool, state({ pasted }), NOW)
    expect(chosen.map((item) => item.path)).toEqual(['/blog/email-to-sms/', '/new-page/'])
    expect(trackPayload(chosen)).toEqual({
      pageIds: [POOL[1]!.pageId],
      urls: ['https://textbolt.com/new-page/'],
      labels: []
    })
  })

  it('keeps the labels a file gave its pages, for project pages and new ones (W3I-C2)', () => {
    const pasted = [
      row('/blog/email-to-sms/', { pageId: null, label: 'Email to SMS guide' }),
      row('/new-page/', { pageId: null, status: null, label: 'New, shiny' })
    ]
    const pool = mergePool(POOL, pasted)
    const chosen = previewRows(pool, state({ pasted }), NOW)
    expect(chosen.map((item) => displayTitle(item))).toEqual(['Email to SMS guide', 'New, shiny'])
    expect(trackPayload(chosen).labels).toEqual([
      { url: 'https://textbolt.com/blog/email-to-sms/', label: 'Email to SMS guide' },
      { url: 'https://textbolt.com/new-page/', label: 'New, shiny' }
    ])
  })

  it('writes the checked file rows as url,label CSV with quoting', () => {
    expect(
      fileRowsCsv([
        { url: 'https://textbolt.com/a/', label: 'Plain' },
        { url: 'https://textbolt.com/b/', label: 'Say "hi", ok' },
        { url: 'https://textbolt.com/c/', label: '' }
      ])
    ).toBe(
      'url,label\nhttps://textbolt.com/a/,Plain\nhttps://textbolt.com/b/,"Say ""hi"", ok"\nhttps://textbolt.com/c/,'
    )
  })
})

describe('import preview', () => {
  it('formats sitemap dates without shifting a date-only value', () => {
    expect(formatLastmod('2026-10-01')).toBe('Oct 1, 2026')
    expect(formatLastmod(null)).toBe('—')
  })
})

describe('import estimate copy', () => {
  const inputs = {
    pages: 2014,
    setupPages: 2014,
    prompts: 5,
    markets: 1,
    samples: 1,
    intervalDays: 30,
    stagger: true
  }
  const base = {
    minSearches: 10070,
    maxSearches: 20140,
    checksPerMonth: 1,
    monthlyMin: 10070,
    monthlyMax: 20140,
    searchesLeft: 3760,
    monthlyPlan: 5000,
    perDayMin: 1439,
    perDayMax: 2877,
    firstRoundFits: false,
    monthlyFits: false,
    claudeCalls: 6042
  }

  it('writes the formula', () => {
    expect(estimateFormula(inputs, base)).toBe(
      '2,014 pages × 5 questions × 1 market × 1–2 searches = 10,070–20,140 searches per check'
    )
  })

  it('says when a large import is over both this month and the plan', () => {
    expect(estimateNotes(inputs, base).over).toMatch(/more than your 5,000-search plan/)
    const fits = estimateNotes(
      { ...inputs, pages: 10 },
      { ...base, firstRoundFits: true, monthlyFits: true, perDayMin: 7, perDayMax: 14 }
    )
    expect(fits).toEqual({
      fit: 'Fits in what you have left this month: about 7–14 searches a day for the first week.',
      over: null
    })
  })
})
