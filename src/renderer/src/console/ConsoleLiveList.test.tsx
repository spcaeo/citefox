// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckInFlightItem, CheckProgress } from '@shared/ipc'
import { ConsoleLog } from './ConsoleLog'
import { consoleReducer, initialConsoleState } from './model'
import { checkLive, checkPurpose, fromCheckProgress } from './sources'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * The Check window's running list (owner, 2026-10-29, watching a real check: "if there
 * are three processes, why don't we show these three processes?", "what is that
 * searching?").
 */

const AT = Date.parse('2026-10-29T10:00:30.000Z')
const ZABBIX = 'Our Zabbix server pages on-call staff through email to an AT&T gateway'

function item(number: number, extra: Partial<CheckInFlightItem> = {}): CheckInFlightItem {
  return {
    pageId: 'topic-1',
    marketId: 'm1',
    promptId: `p${number}`,
    kind: 'question',
    number,
    stage: 'problem',
    text: `Question ${number}`,
    engines: [
      { engine: 'google_aio', status: null },
      { engine: 'chatgpt', status: null }
    ],
    startedAt: '2026-10-29T10:00:18.000Z',
    ...extra
  }
}

function check(extra: Partial<CheckProgress> = {}): CheckProgress {
  return {
    jobId: 'j1',
    projectId: 'p1',
    pageId: 'topic-1',
    marketId: 'm1',
    promptId: 'p9',
    sampleNo: 1,
    phase: 'search',
    state: 'running',
    detail: 'Searching ChatGPT',
    nextStep: null,
    errorCode: null,
    retrySearches: 0,
    done: 6,
    total: 12,
    searchesUsed: 6,
    searchesMax: 60,
    monthUsed: null,
    monthLimit: null,
    markets: [],
    domain: 'textbolt.com',
    inFlight: 3,
    inFlightItems: [
      item(7, { stage: 'options' }),
      item(8, { stage: 'compare' }),
      item(9, {
        text: ZABBIX,
        engines: [
          { engine: 'google_aio', status: 'not_cited' },
          { engine: 'chatgpt', status: null }
        ]
      })
    ],
    lastDone: {
      pageId: 'topic-1',
      marketId: 'm1',
      promptId: 'p6',
      kind: 'question',
      number: 6,
      cited: true,
      finishedAt: '2026-10-29T10:00:25.000Z'
    },
    ...extra
  }
}

function renderCheck(progress: CheckProgress, now: number): void {
  const state = consoleReducer(initialConsoleState(), {
    type: 'update',
    update: fromCheckProgress(progress, AT)
  })
  const job = state.jobs[0]
  if (job === undefined) throw new Error('no job')
  render(
    <ConsoleLog job={job} now={now} closingIn={null} onRetry={() => {}} onKeepOpen={() => {}} />
  )
}

describe('the purpose line', () => {
  it('names the engines asked and the site, in one sentence', () => {
    expect(checkPurpose(check())).toBe(
      'Asking Google AI Overview and ChatGPT each buyer question, to see whether they cite textbolt.com.'
    )
    expect(
      checkPurpose(
        check({
          mix: { questions: 8, keywords: 4 },
          inFlightItems: [item(1, { engines: [{ engine: 'google_aio', status: null }] })]
        })
      )
    ).toBe(
      'Asking Google AI Overview each buyer question and keyword, to see whether it cites textbolt.com.'
    )
  })
})

describe('the running list', () => {
  it('lists Q7, Q8 and Q9 with stage, words, engines ticked and time', () => {
    renderCheck(check(), AT + 5_000)
    // The summary line keeps its count.
    expect(document.body.textContent).toContain('6 of 12 questions · 6 searches used · searching 3')
    expect(document.body.textContent).toContain(
      'Asking Google AI Overview and ChatGPT each buyer question, to see whether they cite textbolt.com.'
    )
    const rows = within(screen.getByRole('list', { name: 'Searching now' })).getAllByRole(
      'listitem'
    )
    expect(rows.map((row) => row.textContent?.split('"')[0]?.trim())).toEqual([
      '▸Q7 · Options',
      '▸Q8 · Compare',
      '▸Q9 · Problem'
    ])
    const q9 = rows[2] as HTMLElement
    expect(q9.textContent).toContain(`"${ZABBIX}"`)
    expect(q9.textContent).toContain('Google AI Overview ✓answered · ChatGPT …still searching')
    expect(q9.textContent).toContain('17 s')
    // The full words are in the tooltip and copy whole.
    expect(within(q9).getByTitle(ZABBIX)).toBeTruthy()
    // The one scored last stays for a moment.
    expect(document.body.textContent).toContain('✓ Q6 cited')
  })

  it('copies a row’s full words', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderCheck(check(), AT + 1_000)
    fireEvent.click(screen.getByRole('button', { name: `Copy ${ZABBIX}` }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(ZABBIX))
  })

  it('drops the last finished one after a few seconds, and the list when the check ends', () => {
    renderCheck(check(), AT + 40_000)
    expect(document.body.textContent).not.toContain('Q6 cited')
    cleanup()
    renderCheck(check({ done: 12, inFlight: undefined, inFlightItems: undefined }), AT)
    expect(screen.queryByTestId('wc-live')).toBeNull()
  })

  it('keeps today’s wording for a check of one question', () => {
    expect(checkLive(check({ total: 1, done: 0 }), false)).toBeNull()
    renderCheck(
      check({
        total: 1,
        done: 0,
        inFlight: 1,
        inFlightItems: [item(1)],
        promptText: 'best sms api',
        detail: 'Searching Google'
      }),
      AT
    )
    expect(screen.queryByTestId('wc-live')).toBeNull()
    expect(document.body.textContent).toContain('Searching Google for "best sms api"')
  })

  it('numbers keywords apart', () => {
    const live = checkLive(
      check({ inFlightItems: [item(2, { kind: 'keyword', stage: null })] }),
      false
    )
    expect(live?.rows.map((row) => [row.label, row.stage])).toEqual([['K2', null]])
  })
})
