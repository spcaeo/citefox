import { describe, expect, test } from 'vitest'
import type { PromptCheckRow } from './domain'
import {
  citedTrend,
  citesOwnSite,
  citesPage,
  controlLine,
  controlMove,
  fixVerdict,
  updatesInWindow,
  verdictDaysLeft,
  verdictLabel,
  verdictSummary,
  workingNote,
  type FixControl,
  type FixQuestion
} from './fix-verdict'
import type { GoogleUpdate } from './google-updates'

const LIVE = '2026-10-01T00:00:00.000Z'
const BEFORE_AT = '2026-09-28T09:00:00.000Z'
const NOW_AT = '2026-10-20T09:00:00.000Z'

function question(
  promptId: string,
  before: boolean | null,
  now: boolean | null,
  source = 'topic-1'
): FixQuestion {
  return {
    promptId,
    sourceId: source,
    sourceKind: source.startsWith('topic') ? 'topic' : 'page',
    sourceName: source,
    marketId: 'us',
    label: promptId.toUpperCase(),
    text: `question ${promptId}`,
    before:
      before === null
        ? null
        : { runId: 'r-before', checkedAt: BEFORE_AT, cited: before, position: before ? 2 : null },
    now:
      now === null
        ? null
        : { runId: 'r-now', checkedAt: NOW_AT, cited: now, position: now ? 1 : null }
  }
}

function update(id: string, startedOn: string, finishedOn: string | null): GoogleUpdate {
  return {
    id,
    name: `${id} update`,
    kind: 'core',
    startedOn,
    finishedOn,
    description: 'A change.',
    url: 'https://status.search.google.com/'
  }
}

const NO_UPDATES: readonly GoogleUpdate[] = []

function verdict(
  questions: readonly FixQuestion[],
  options: { now?: string; control?: FixControl | null; updates?: readonly GoogleUpdate[] } = {}
): ReturnType<typeof fixVerdict> {
  return fixVerdict(
    { questions, control: options.control ?? null },
    {
      liveSince: LIVE,
      now: options.now ?? '2026-10-29T12:00:00.000Z',
      updates: options.updates ?? NO_UPDATES
    }
  )
}

function row(partial: Partial<PromptCheckRow>): PromptCheckRow {
  return { status: 'not_cited', citedUrl: null, references: [], ...partial } as PromptCheckRow
}

describe('citesPage', () => {
  test('matches the cited URL or any source, ignoring www, case, slash and query', () => {
    expect(
      citesPage(
        row({ citedUrl: 'https://www.example.com/Blog/Post/' }),
        'https://example.com/blog/post'
      )
    ).toBe(true)
    expect(
      citesPage(
        row({
          status: 'other_own_page',
          references: [
            { url: 'https://example.com/blog/post?utm=x' } as PromptCheckRow['references'][number]
          ]
        }),
        'https://example.com/blog/post'
      )
    ).toBe(true)
    expect(
      citesPage(row({ citedUrl: 'https://example.com/pricing' }), 'https://example.com/blog/post')
    ).toBe(false)
  })

  test('with no page, any page of the site counts', () => {
    expect(citesPage(row({ status: 'other_own_page' }), null)).toBe(true)
    expect(citesPage(row({ status: 'page_cited' }), null)).toBe(true)
    expect(citesPage(row({ status: 'not_cited' }), null)).toBe(false)
    expect(citesOwnSite(row({ status: 'no_aio' }))).toBe(false)
  })
})

describe('fixVerdict', () => {
  test('too early before 14 days live, with the days left', () => {
    const view = verdict([question('q1', false, true)], { now: '2026-10-11T08:00:00.000Z' })
    expect(view.state).toBe('too_early')
    expect(view.daysLive).toBe(10)
    expect(view.daysLeft).toBe(4)
    expect(verdictLabel(view)).toBe('Too early · 4 days left')
    expect(view.tone).toBe('wait')
    expect(view.control).toBeNull()
    // The numbers are still counted while it waits.
    expect(view.citedNow).toBe(1)
  })

  test('one day left reads singular; day 14 gives a verdict', () => {
    expect(
      verdictLabel(verdict([question('q1', false, true)], { now: '2026-10-14T08:00:00.000Z' }))
    ).toBe('Too early · 1 day left')
    expect(verdict([question('q1', false, true)], { now: '2026-10-15T08:00:00.000Z' }).state).toBe(
      'worked'
    )
  })

  test('a fix that goes live later is planned', () => {
    const view = verdict([question('q1', null, null)], { now: '2026-09-29T08:00:00.000Z' })
    expect(view.state).toBe('planned')
    expect(verdictLabel(view)).toBe('Goes live in 2 days')
  })

  test('worked: more searches cite the page now, and the won and lost lists', () => {
    const view = verdict([
      question('q1', false, true),
      question('q2', false, true),
      question('q3', true, true),
      question('q4', true, false),
      question('q5', false, false)
    ])
    expect(view.state).toBe('worked')
    expect(view.tone).toBe('good')
    expect(view.won).toEqual(['q1', 'q2'])
    expect(view.lost).toEqual(['q4'])
    expect(view.citedBefore).toBe(2)
    expect(view.citedNow).toBe(3)
    expect(view.measured).toBe(5)
    expect(verdictSummary(view)).toBe('Won 2 searches, lost 1 search. Live 28 days.')
  })

  test('worse when losses outweigh the wins, no change when they even out', () => {
    const worse = verdict([
      question('q1', true, false),
      question('q2', true, false),
      question('q3', false, true)
    ])
    expect(worse.state).toBe('worse')
    expect(worse.tone).toBe('bad')
    const even = verdict([question('q1', true, false), question('q2', false, true)])
    expect(even.state).toBe('no_change')
    expect(verdictLabel(even)).toBe('No change')
    const still = verdict([question('q1', false, false)])
    expect(still.state).toBe('no_change')
    expect(verdictSummary(still)).toBe('Won none, lost none. Live 28 days.')
  })

  test('a search never checked before go-live counts as not cited before', () => {
    const view = verdict([question('q1', null, true)])
    expect(view.won).toEqual(['q1'])
    expect(view.state).toBe('worked')
  })

  test('only searches checked since go-live count; none yet is waiting', () => {
    const view = verdict([question('q1', true, null), question('q2', false, true)])
    expect(view.measured).toBe(1)
    expect(view.citedBefore).toBe(0)
    expect(view.lost).toEqual([])
    const waiting = verdict([question('q1', true, null)])
    expect(waiting.state).toBe('waiting')
    expect(verdictLabel(waiting)).toBe('Waiting for a check')
    expect(verdictSummary(waiting)).toBe('No check since it went live yet. Live 28 days.')
  })

  test('the window runs from the earliest before check to the latest check since', () => {
    const view = verdict([question('q1', false, true)])
    expect(view.window).toEqual({ from: BEFORE_AT, to: NOW_AT })
    const unchecked = verdict([question('q1', null, null)])
    expect(unchecked.window).toEqual({ from: LIVE, to: '2026-10-29T12:00:00.000Z' })
  })

  test('a Google update inside the window makes the verdict less certain', () => {
    const inside = update('oct', '2026-10-08', '2026-10-22')
    const outside = update('aug', '2026-08-01', '2026-08-10')
    const view = verdict([question('q1', false, true)], { updates: [outside, inside] })
    expect(view.updates.map((item) => item.id)).toEqual(['oct'])
    expect(view.lessCertain).toBe(true)
    expect(verdict([question('q1', false, true)], { updates: [outside] }).lessCertain).toBe(false)
  })

  test('untouched searches that moved the same way make it less certain', () => {
    const same = verdict([question('q1', false, true), question('q2', false, false)], {
      control: { questions: 10, citedBefore: 2, citedNow: 6 }
    })
    expect(same.control).toBe('same')
    expect(same.lessCertain).toBe(true)
    expect(controlLine(same)).toBe(
      'Similar searches you did not touch moved the same way, so this may not be your fix.'
    )
    const flat = verdict([question('q1', false, true)], {
      control: { questions: 10, citedBefore: 3, citedNow: 3 }
    })
    expect(flat.control).toBe('flat')
    expect(flat.lessCertain).toBe(false)
    expect(controlLine(flat)).toBe(
      'Similar searches you did not touch: no change, so this looks like your fix.'
    )
  })
})

describe('controlMove', () => {
  test('too few, flat, other and same', () => {
    expect(controlMove(null, 0.5)).toBe('too_few')
    expect(controlMove({ questions: 2, citedBefore: 0, citedNow: 2 }, 0.5)).toBe('too_few')
    expect(controlMove({ questions: 40, citedBefore: 10, citedNow: 11 }, 0.5)).toBe('flat')
    expect(controlMove({ questions: 10, citedBefore: 6, citedNow: 3 }, 0.5)).toBe('other')
    expect(controlMove({ questions: 10, citedBefore: 2, citedNow: 3 }, 0.5)).toBe('flat')
    expect(controlMove({ questions: 10, citedBefore: 2, citedNow: 5 }, 0.5)).toBe('same')
    expect(controlMove({ questions: 10, citedBefore: 2, citedNow: 5 }, 0)).toBe('other')
  })

  test('the line for each move and verdict', () => {
    expect(controlLine({ state: 'worked', control: null })).toBeNull()
    expect(controlLine({ state: 'worked', control: 'too_few' })).toBe(
      'Too few similar searches you did not touch to compare.'
    )
    expect(controlLine({ state: 'worse', control: 'other' })).toBe(
      'Similar searches you did not touch went the other way, so this looks like your fix.'
    )
    expect(controlLine({ state: 'no_change', control: 'flat' })).toBe(
      'Similar searches you did not touch did not move either.'
    )
    expect(controlLine({ state: 'no_change', control: 'same' })).toBe(
      'Similar searches you did not touch moved in the same time.'
    )
  })
})

describe('updatesInWindow', () => {
  test('a rollout touching either end counts; one still running reaches now', () => {
    const updates = [
      update('ends-on-from', '2026-09-20', '2026-09-28'),
      update('starts-on-to', '2026-10-20', '2026-10-30'),
      update('running', '2026-09-01', null),
      update('before', '2026-09-01', '2026-09-10'),
      update('after', '2026-10-21', '2026-10-25')
    ]
    expect(updatesInWindow(updates, BEFORE_AT, NOW_AT).map((item) => item.id)).toEqual([
      'ends-on-from',
      'starts-on-to',
      'running'
    ])
    expect(updatesInWindow(updates, 'nope', NOW_AT)).toEqual([])
  })
})

describe('verdictDaysLeft and workingNote', () => {
  test('days left never goes below zero', () => {
    expect(verdictDaysLeft(3)).toBe(11)
    expect(verdictDaysLeft(30)).toBe(0)
    expect(verdictDaysLeft(null)).toBe(14)
  })

  test('the Activity note counts the extra searches', () => {
    expect(workingNote(2, '/blog/post', { citedBefore: 1, citedNow: 5 })).toBe(
      'Fix 2 on /blog/post is working: 4 more searches cite it'
    )
    expect(workingNote(1, '/a', { citedBefore: 0, citedNow: 1 })).toBe(
      'Fix 1 on /a is working: 1 more search cites it'
    )
  })
})

describe('citedTrend', () => {
  test('each check updates the searches it holds; the rest keep their last result', () => {
    const points = citedTrend([
      { at: '2026-10-05T00:00:00.000Z', states: [['q1', true]] },
      {
        at: '2026-09-28T00:00:00.000Z',
        states: [
          ['q1', false],
          ['q2', false]
        ]
      },
      { at: '2026-10-12T00:00:00.000Z', states: [['q2', true]] }
    ])
    expect(points).toEqual([
      { at: '2026-09-28T00:00:00.000Z', cited: 0, checked: 2 },
      { at: '2026-10-05T00:00:00.000Z', cited: 1, checked: 2 },
      { at: '2026-10-12T00:00:00.000Z', cited: 2, checked: 2 }
    ])
  })

  test('checks at the same moment merge, and only the newest points are kept', () => {
    const at = '2026-10-05T00:00:00.000Z'
    expect(
      citedTrend([
        { at, states: [['q1', true]] },
        { at, states: [['q2', true]] }
      ])
    ).toEqual([{ at, cited: 2, checked: 2 }])
    const many = Array.from({ length: 20 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      states: [['q1', index % 2 === 0]] as const
    }))
    const kept = citedTrend(many, 5)
    expect(kept).toHaveLength(5)
    expect(kept.at(-1)?.at).toBe(new Date(Date.UTC(2026, 0, 20)).toISOString())
  })
})
