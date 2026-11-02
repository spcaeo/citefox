import { describe, expect, it } from 'vitest'
import type { QuestionEngineStatuses } from '@shared/ipc'
import { questionRow } from '../../../questions/questions.fixtures.test-helper'
import { checkStatusOnEngine, rowsOnEngine, withEngine } from './engine'
import { rowTotals } from './dashboard'

const TARGET = 'https://textbolt.com/email-to-text/'

describe('the topic views on one engine (audit #4)', () => {
  it('reads a cited answer as the target page only when it cites the target', () => {
    expect(checkStatusOnEngine('cited', ['https://www.textbolt.com/email-to-text'], TARGET)).toBe(
      'page_cited'
    )
    expect(checkStatusOnEngine('cited', ['https://textbolt.com/pricing/'], TARGET)).toBe(
      'other_own_page'
    )
    expect(checkStatusOnEngine('cited', ['https://textbolt.com/pricing/'], null)).toBe(
      'other_own_page'
    )
    // No pages named (an older summary): cited, as Questions counts it.
    expect(checkStatusOnEngine('cited', undefined, TARGET)).toBe('page_cited')
    expect(checkStatusOnEngine('named', undefined, TARGET)).toBe('brand_mentioned')
    expect(checkStatusOnEngine('not_cited', undefined, TARGET)).toBe('not_cited')
    expect(checkStatusOnEngine('no_answer', undefined, TARGET)).toBe('no_aio')
    expect(checkStatusOnEngine('unavailable', undefined, TARGET)).toBe('error')
    expect(checkStatusOnEngine(undefined, undefined, TARGET)).toBeNull()
  })

  it('re-counts rows from the engine’s answers by the headline rule', () => {
    const row = (promptId: string): ReturnType<typeof questionRow> =>
      questionRow({
        promptId,
        sourceId: 'topic-a',
        text: promptId,
        targetUrl: TARGET,
        status: 'page_cited'
      })
    const rows = ['q1', 'q2', 'q3', 'q4', 'q5'].map(row)
    const statuses = (
      promptId: string,
      chatgpt: QuestionEngineStatuses['statuses']['chatgpt'],
      ownUrls?: string[]
    ): QuestionEngineStatuses => ({
      pageId: 'topic-a',
      promptId,
      marketId: 'm-us',
      statuses: { google_aio: 'cited', ...(chatgpt ? { chatgpt } : {}) },
      ...(ownUrls ? { ownUrls: { chatgpt: ownUrls } } : {})
    })
    const questions = [
      statuses('q1', 'cited', [TARGET]),
      statuses('q2', 'cited', ['https://textbolt.com/pricing/']),
      statuses('q3', 'named'),
      statuses('q4', 'no_answer'),
      // Another market's answer is not this one's.
      { ...statuses('q5', 'cited', [TARGET]), marketId: 'm-uk' }
    ]
    // All and Google keep Google's rows as they are.
    expect(rowsOnEngine(rows, 'all', questions, 'm-us')).toBe(rows)
    expect(rowsOnEngine(rows, 'google_aio', questions, 'm-us')).toBe(rows)
    const chatgpt = rowsOnEngine(rows, 'chatgpt', questions, 'm-us')
    expect(chatgpt.map((item) => item.status)).toEqual([
      'page_cited',
      'other_own_page',
      'brand_mentioned',
      'no_aio',
      null
    ])
    expect(chatgpt.map((item) => [item.overview, item.cited, item.named])).toEqual([
      [true, true, false],
      [true, true, false],
      [true, false, true],
      [false, null, null],
      [null, null, null]
    ])
    expect(chatgpt[0]).toMatchObject({ citedInstead: [], previous: null, change: 'none' })
    const totals = rowTotals(chatgpt)
    expect(totals).toMatchObject({ searches: 5, withAio: 3, needsWork: 2, targetPct: 33 })
  })

  it('keeps the picked engine on a link', () => {
    expect(withEngine('#/topics/t1', 'all')).toBe('#/topics/t1')
    expect(withEngine('#/topics/t1?market=m-us', 'chatgpt')).toBe(
      '#/topics/t1?market=m-us&engine=chatgpt'
    )
  })
})
