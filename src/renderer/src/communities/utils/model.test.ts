import { describe, expect, test } from 'vitest'
import type { CommunityAio, Market, SourceMixCheck } from '@shared/domain'
import {
  ageDays,
  ageLabel,
  checkColumnLabel,
  citedOnLabel,
  dateRange,
  formatCount,
  formatDuration,
  marketsShort,
  namedKeys,
  replyLabel,
  resolveDrill,
  segmentWidth,
  share,
  signedChange,
  sourceTypeLabel,
  statusLabel,
  typeCitations
} from './model'
import { threadResultText } from './messages'
import { sortRows } from './sort'
import { errorText } from './errors'

function aio(key: string, named: boolean | null): CommunityAio {
  return {
    key,
    runId: key.split('|')[0] ?? '',
    pageId: 'page-1',
    pageLabel: 'Alerts',
    marketId: 'mkt-us',
    promptId: key.split('|')[1] ?? '',
    promptPosition: 1,
    label: 'Crew alerts',
    text: 'How do I alert the crew?',
    status: 'not_cited',
    named,
    checkedAt: '2026-10-19T12:00:00.000Z',
    latest: true
  }
}

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

function check(index: number, from: string, to: string): SourceMixCheck {
  return {
    index,
    from,
    to,
    aios: 2,
    aioKeys: ['a|1', 'a|2'],
    citations: 6,
    types: [
      { type: 'web', citations: 3, aios: 2, aioKeys: ['a|1', 'a|2'] },
      { type: 'reddit', citations: 3, aios: 1, aioKeys: ['a|1'] }
    ],
    owners: []
  }
}

describe('community labels', () => {
  test('names source types, reply states and statuses in plain words', () => {
    expect(sourceTypeLabel('forum')).toBe('Other forums')
    expect(sourceTypeLabel('review')).toBe('Review sites')
    expect(replyLabel('archived')).toBe('Archived')
    expect(replyLabel('unchecked')).toBe('Unchecked')
    expect(statusLabel('other_own_page')).toBe('Your other page')
    expect(statusLabel('page_cited')).toBe('Right page')
    expect(statusLabel('not_cited')).toBe('Not cited')
  })

  test('the questions column reads questions on a page and pages in a project', () => {
    expect(citedOnLabel('page', [1, 2], 1)).toBe('Questions 1, 2')
    expect(citedOnLabel('page', [3], 1)).toBe('Question 3')
    expect(citedOnLabel('project', [1], 3)).toBe('3 pages')
    expect(citedOnLabel('project', [1], 1)).toBe('1 page')
  })

  test('short market labels keep the flag and country', () => {
    expect(marketsShort([US], ['mkt-us', 'mkt-x'])).toBe('🇺🇸 US, mkt-x')
  })
})

describe('mix numbers', () => {
  test('shares round to a whole percent and segment widths fill the bar', () => {
    expect(share(7, 15)).toBe(47)
    expect(share(1, 0)).toBe(0)
    expect(segmentWidth(1, 3)).toBe('33.33%')
    expect(segmentWidth(1, 0)).toBe('0%')
  })

  test('check columns name the date on a page and the age in a project', () => {
    const newest = check(0, '2026-10-19T12:00:00.000Z', '2026-10-19T13:00:00.000Z')
    expect(checkColumnLabel(newest, 'page')).toBe('Oct 19')
    expect(checkColumnLabel(newest, 'project')).toBe('Latest check')
    expect(checkColumnLabel(check(1, newest.from, newest.to), 'project')).toBe('Check before')
    expect(dateRange({ from: '2026-10-05T12:00:00.000Z', to: '2026-10-06T12:00:00.000Z' })).toBe(
      'Oct 5 – Oct 6'
    )
    expect(typeCitations(newest, 'reddit')).toBe(3)
    expect(typeCitations(newest, 'youtube')).toBe(0)
    expect(signedChange(3)).toBe('+3')
    expect(signedChange(-2)).toBe('−2')
    expect(signedChange(0)).toBe('0')
  })
})

describe('drill keys', () => {
  test('a drill lists exactly the known answers for its keys, in key order', () => {
    const report = { aios: [aio('r1|p1', true), aio('r1|p2', false), aio('r2|p1', null)] }
    expect(resolveDrill(report, ['r2|p1', 'r1|p1', 'gone|x']).map((row) => row.key)).toEqual([
      'r2|p1',
      'r1|p1'
    ])
    expect(namedKeys(report, ['r1|p1', 'r1|p2', 'r2|p1'])).toEqual(['r1|p1'])
  })
})

describe('ages and numbers', () => {
  const now = '2026-10-20T00:00:00.000Z'
  test('thread age reads days, weeks, months and years', () => {
    expect(ageLabel('2026-10-19T00:00:00.000Z', now)).toBe('1 day')
    expect(ageLabel('2026-10-10T00:00:00.000Z', now)).toBe('10 days')
    expect(ageLabel('2026-09-20T00:00:00.000Z', now)).toBe('4 weeks')
    expect(ageLabel('2026-04-20T00:00:00.000Z', now)).toBe('6 months')
    expect(ageLabel('2024-10-01T00:00:00.000Z', now)).toBe('2 years')
    expect(ageLabel(null, now)).toBeNull()
    expect(ageDays('2026-10-10T00:00:00.000Z', now)).toBe(10)
  })

  test('counts and lengths', () => {
    expect(formatCount(48210)).toBe('48,210')
    expect(formatCount(null)).toBe('—')
    expect(formatDuration(312)).toBe('5:12')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('sortRows', () => {
  const rows = [
    { name: 'b', n: 2 },
    { name: 'A', n: null },
    { name: 'c', n: 2 },
    { name: 'a', n: 5 }
  ]
  test('sorts by several keys, empty values last, ties in original order', () => {
    const value = (row: (typeof rows)[number], key: 'name' | 'n'): string | number | null =>
      key === 'name' ? row.name : row.n
    expect(sortRows(rows, [{ key: 'n', dir: 'desc' }], value).map((row) => row.name)).toEqual([
      'a',
      'b',
      'c',
      'A'
    ])
    expect(sortRows(rows, [{ key: 'n', dir: 'asc' }], value).map((row) => row.name)).toEqual([
      'b',
      'c',
      'a',
      'A'
    ])
    expect(
      sortRows(
        rows,
        [
          { key: 'n', dir: 'asc' },
          { key: 'name', dir: 'desc' }
        ],
        value
      ).map((row) => row.name)
    ).toEqual(['c', 'b', 'a', 'A'])
  })
})

describe('messages', () => {
  test('a thread check reads as one sentence', () => {
    expect(threadResultText({ checked: 2, cached: 0, failed: 0, skipped: 0, message: null })).toBe(
      'Read 2 threads.'
    )
    expect(
      threadResultText({
        checked: 1,
        cached: 1,
        failed: 1,
        skipped: 3,
        message: 'Reddit asked CiteFox to slow down.'
      })
    ).toBe(
      'Read 1 thread, 1 already read today, 1 could not be read, 3 left for later. Reddit asked CiteFox to slow down.'
    )
  })

  test('errors drop the invoke wrapper and the channel', () => {
    expect(
      errorText(
        new Error(
          "Error invoking remote method 'communities:get': Error: communities:get: That page was not found"
        ),
        'x'
      )
    ).toBe('That page was not found')
    expect(errorText('nope', 'Fallback')).toBe('Fallback')
  })
})
