import { describe, expect, test } from 'vitest'
import { fixVerdictLabel } from '@shared/domain'
import { otherPromptsMoved, promptResult, verdictFor } from './verdict'

describe('fix prompt results (FR-14.7, section 7.3)', () => {
  test('gained and improved worked, lost and declined got worse, same status is no change', () => {
    expect(
      promptResult(
        { status: 'brand_mentioned', position: null },
        { status: 'page_cited', position: 3 }
      )
    ).toBe('worked')
    expect(
      promptResult(
        { status: 'not_cited', position: null },
        { status: 'other_own_page', position: 2 }
      )
    ).toBe('worked')
    expect(
      promptResult({ status: 'page_cited', position: 5 }, { status: 'page_cited', position: 2 })
    ).toBe('worked')
    expect(
      promptResult({ status: 'page_cited', position: 5 }, { status: 'not_cited', position: null })
    ).toBe('got_worse')
    expect(
      promptResult(
        { status: 'other_own_page', position: 1 },
        { status: 'not_cited', position: null }
      )
    ).toBe('got_worse')
    expect(
      promptResult({ status: 'not_cited', position: null }, { status: 'not_cited', position: null })
    ).toBe('no_change')
    expect(
      promptResult({ status: 'no_aio', position: null }, { status: 'not_cited', position: null })
    ).toBe('no_change')
  })

  test('a missing before or after result is not checked', () => {
    expect(promptResult(null, { status: 'page_cited', position: 1 })).toBe('not_checked')
    expect(promptResult({ status: 'page_cited', position: 1 }, null)).toBe('not_checked')
  })
})

describe('fix verdicts', () => {
  test('all better worked; some better partly worked; worse only got worse; else no change', () => {
    expect(verdictFor(['worked', 'worked'], true)).toEqual({
      verdict: 'worked',
      compared: 2,
      worked: 2,
      worse: 0
    })
    const partly = verdictFor(['worked', 'no_change', 'got_worse'], true)
    expect(partly).toEqual({ verdict: 'partly', compared: 3, worked: 1, worse: 1 })
    expect(fixVerdictLabel(partly.verdict, partly.worked, partly.compared)).toBe(
      'Partly worked · 1 of 3 prompts'
    )
    expect(verdictFor(['got_worse', 'no_change'], true).verdict).toBe('got_worse')
    expect(verdictFor(['no_change', 'no_change'], true).verdict).toBe('no_change')
  })

  test('prompts not checked are left out of the count', () => {
    const result = verdictFor(['worked', 'not_checked'], true)
    expect(result).toEqual({ verdict: 'worked', compared: 1, worked: 1, worse: 0 })
    expect(fixVerdictLabel('partly', 1, 1)).toBe('Partly worked · 1 of 1 prompt')
  })

  test('no after check, or nothing comparable, is waiting', () => {
    expect(verdictFor(['not_checked'], false).verdict).toBe('waiting')
    expect(verdictFor(['not_checked', 'not_checked'], true).verdict).toBe('waiting')
    expect(fixVerdictLabel('waiting', 0, 0)).toBe('Waiting for the follow-up')
  })
})

describe('non-targeted prompts that moved in the same period', () => {
  test('counts prompts in both checks whose result moved, never the targeted ones', () => {
    const before = new Map([
      ['p1', { status: 'not_cited' as const, position: null }],
      ['p2', { status: 'page_cited' as const, position: 4 }],
      ['p3', { status: 'not_cited' as const, position: null }],
      ['p4', { status: 'no_aio' as const, position: null }]
    ])
    const after = new Map([
      ['p1', { status: 'page_cited' as const, position: 1 }],
      ['p2', { status: 'page_cited' as const, position: 4 }],
      ['p3', { status: 'brand_mentioned' as const, position: null }],
      ['p5', { status: 'page_cited' as const, position: 2 }]
    ])
    expect(otherPromptsMoved(before, after, new Set(['p1']))).toEqual({
      total: 2,
      moved: 1,
      promptIds: ['p3']
    })
  })
})
