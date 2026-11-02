import { describe, expect, test } from 'vitest'
import {
  accountProblem,
  classifyClaudeFailure,
  describeResetTime,
  limitReplyOnly,
  parseResetTime,
  readLimit
} from './limits'
import { parseClaudeCliOutput } from './parse'

// Thursday Oct 29 2026, 2:00 PM in Toronto (EDT, UTC-4). Toronto falls back to EST
// (UTC-5) on Sunday Nov 1.
const NOW = new Date('2026-10-29T18:00:00Z')
const TORONTO = 'America/Toronto'

function limitOf(text: string, now = NOW, zone = TORONTO): ReturnType<typeof readLimit> {
  const failure = classifyClaudeFailure(text, now, zone)
  if (failure?.kind !== 'limit') throw new Error(`not a limit: ${text}`)
  return failure.limit
}

describe('Claude Code limit messages', () => {
  test.each([
    [
      "You've hit your session limit · resets 7:30pm (America/Toronto)",
      'session',
      '2026-10-29T23:30:00.000Z'
    ],
    // Nov 2 is after the clocks go back: 9am EST is 14:00 UTC.
    ["You've hit your weekly limit · resets Nov 2, 9am", 'weekly', '2026-11-02T14:00:00.000Z'],
    ['Weekly limit reached ∙ resets 3pm', 'weekly', '2026-10-29T19:00:00.000Z'],
    ['5-hour limit reached ∙ resets 3pm', 'session', '2026-10-29T19:00:00.000Z'],
    ['Opus weekly limit reached', 'weekly', null],
    [
      "You've hit your 5-hour limit · resets 3pm (America/Toronto)",
      'session',
      '2026-10-29T19:00:00.000Z'
    ],
    [
      'You’ve hit your weekly limit · resets Nov 2, 9am (America/Toronto) · progress saved',
      'weekly',
      '2026-11-02T14:00:00.000Z'
    ],
    [
      "You've hit your Opus limit · resets Nov 3, 10:15am (America/Toronto)",
      'weekly',
      '2026-11-03T15:15:00.000Z'
    ],
    [
      "You've hit your usage limit · resets 6pm (America/Toronto)",
      'session',
      '2026-10-29T22:00:00.000Z'
    ]
  ])('%s', (text, kind, resetsAt) => {
    const limit = limitOf(text)
    expect(limit.kind).toBe(kind)
    expect(limit.resetsAt?.toISOString() ?? null).toBe(resetsAt)
  })

  test('the epoch form, in seconds, with the window read from how far away it is', () => {
    const soon = Date.UTC(2026, 9, 29, 21, 0) / 1000
    const later = Date.UTC(2026, 10, 1, 21, 0) / 1000
    expect(limitOf(`Claude AI usage limit reached|${soon}`)).toEqual({
      kind: 'session',
      resetsAt: new Date(soon * 1000)
    })
    expect(limitOf(`Claude AI usage limit reached|${later}`).kind).toBe('weekly')
  })

  test('the limit named first wins over a later mention of another', () => {
    const text =
      "You've hit your 5-hour limit · resets 3pm (America/Toronto) · /reset-limit to reset your 5-hour limit now (uses your weekly limit)"
    expect(limitOf(text).kind).toBe('session')
  })

  test('a message with neither a window nor a time is unknown', () => {
    expect(limitOf('Claude Code hit a plan limit.')).toEqual({ kind: 'unknown', resetsAt: null })
  })
})

describe('reset time', () => {
  test('a named zone is used even when this computer is elsewhere', () => {
    // 11:30 PM already in Kolkata, so 7:30pm is tomorrow there.
    expect(
      parseResetTime('resets 7:30pm (Asia/Kolkata)', NOW, 'Europe/London')?.toISOString()
    ).toBe('2026-10-30T14:00:00.000Z')
    expect(parseResetTime('resets 9am (UTC)', NOW, TORONTO)?.toISOString()).toBe(
      '2026-10-30T09:00:00.000Z'
    )
  })

  test('no zone reads the local zone', () => {
    expect(parseResetTime('resets 7:30pm', NOW, 'Europe/London')?.toISOString()).toBe(
      '2026-10-29T19:30:00.000Z'
    )
  })

  test('an unknown zone falls back to the local zone', () => {
    expect(parseResetTime('resets 7:30pm (Mars/Olympus_Mons)', NOW, TORONTO)?.toISOString()).toBe(
      '2026-10-29T23:30:00.000Z'
    )
  })

  test('a time already passed today rolls to tomorrow', () => {
    expect(parseResetTime('resets 1pm (America/Toronto)', NOW)?.toISOString()).toBe(
      '2026-10-30T17:00:00.000Z'
    )
    expect(parseResetTime('resets 2pm (America/Toronto)', NOW)?.toISOString()).toBe(
      '2026-10-30T18:00:00.000Z'
    )
  })

  test('a month-day long past rolls to next year; yesterday stays', () => {
    const december = new Date('2026-12-30T15:00:00Z')
    expect(parseResetTime('resets Jan 2, 9am (America/Toronto)', december)?.toISOString()).toBe(
      '2027-01-02T14:00:00.000Z'
    )
    expect(parseResetTime('resets Oct 29, 9am (America/Toronto)', NOW)?.toISOString()).toBe(
      '2026-10-29T13:00:00.000Z'
    )
  })

  test('24-hour clock, relative times and ISO stamps', () => {
    expect(parseResetTime('resets 19:45 (America/Toronto)', NOW)?.toISOString()).toBe(
      '2026-10-29T23:45:00.000Z'
    )
    expect(parseResetTime('resets in 2h 15m', NOW)?.toISOString()).toBe('2026-10-29T20:15:00.000Z')
    expect(parseResetTime('resets in 3 days', NOW)?.toISOString()).toBe('2026-11-01T18:00:00.000Z')
    expect(parseResetTime('resets at 2026-11-02T09:00:00Z', NOW)?.toISOString()).toBe(
      '2026-11-02T09:00:00.000Z'
    )
  })

  test('epoch in milliseconds is accepted too', () => {
    const ms = Date.UTC(2026, 9, 29, 21, 0)
    expect(parseResetTime(`Claude AI usage limit reached|${ms}`, NOW)?.getTime()).toBe(ms)
  })

  test('no time at all is null, and a bare number is not a time', () => {
    expect(parseResetTime('Weekly limit reached', NOW)).toBeNull()
    expect(parseResetTime('resets soon, after 5 more calls', NOW)).toBeNull()
  })

  test('words for the reset, in the local zone', () => {
    expect(describeResetTime(new Date('2026-10-29T23:30:00Z'), NOW, TORONTO)).toBe(
      'today at 7:30 PM'
    )
    expect(describeResetTime(new Date('2026-10-30T13:00:00Z'), NOW, TORONTO)).toBe(
      'tomorrow at 9:00 AM'
    )
    expect(describeResetTime(new Date('2026-11-02T14:00:00Z'), NOW, TORONTO)).toBe(
      'Monday, Nov 2 at 9:00 AM'
    )
  })
})

describe('account problems come before limits', () => {
  test.each([
    ['Not logged in · Please run /login', 'logged_out'],
    ['Login expired · Please run /login', 'logged_out'],
    ['OAuth token revoked · Please run /login', 'logged_out'],
    [
      'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}',
      'logged_out'
    ],
    ['Invalid API key · Please run /login', 'unauthorized'],
    ['Invalid API key · Fix external API key', 'unauthorized'],
    ['API Error: 401 {"type":"error","error":{"type":"authentication_error"}}', 'unauthorized'],
    ['Credit balance is too low', 'credit_low'],
    [
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      'credit_low'
    ],
    [
      'Credit balance too low · Add funds: https://platform.claude.com/settings/billing',
      'credit_low'
    ],
    ['Your Claude subscription has expired. Renew your plan at claude.ai.', 'plan_inactive'],
    ['Your subscription is no longer active.', 'plan_inactive'],
    ["Your account is on hold and can't use Claude Code. View details or appeal:", 'plan_inactive'],
    ['This organization has been disabled.', 'plan_inactive'],
    ['Your account does not have access to Claude Code. Please run /login.', 'plan_inactive']
  ])('%s', (text, problem) => {
    expect(accountProblem(text)).toBe(problem)
    expect(classifyClaudeFailure(text, NOW)).toEqual({ kind: 'account', problem })
  })

  test('signed out with a limit word nearby is still signed out', () => {
    expect(classifyClaudeFailure('Not logged in · Please run /login (usage limit)', NOW)).toEqual({
      kind: 'account',
      problem: 'logged_out'
    })
  })

  test('rate limits and overload are short waits, not plan limits', () => {
    expect(
      classifyClaudeFailure(
        'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
        NOW
      )
    ).toEqual({ kind: 'transient', code: 'overloaded' })
    expect(
      classifyClaudeFailure('API Error: 429 {"error":{"type":"rate_limit_error"}}', NOW)
    ).toEqual({ kind: 'transient', code: 'rate_limited' })
  })
})

describe('a normal answer that mentions limits is not a limit', () => {
  test.each([
    'Most plans have a usage limit. You can raise it in Settings.',
    "Great question! You've hit your stride with these prompts.",
    'The API rate limit is 50 requests per minute; Weekly limit reached is shown in the app.',
    '{"brands":[{"name":"Acme","reason":"Their weekly limit reached 40 users"}]}'
  ])('%s', (text) => {
    expect(limitReplyOnly(text, NOW)).toBeNull()
  })

  test('a reply that is only a limit line is one, and a long one is not', () => {
    expect(
      limitReplyOnly("You've hit your weekly limit · resets Nov 2, 9am", NOW, TORONTO)?.kind
    ).toBe('weekly')
    expect(limitReplyOnly(`You've hit your limit. ${'More text. '.repeat(50)}`, NOW)).toBeNull()
  })

  test('the CLI parser keeps an answer that talks about limits', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Most plans have a usage limit. Weekly limit reached is a common message.'
    })
    expect(parseClaudeCliOutput(stdout, '', null, [], NOW)).toMatchObject({ ok: true })
  })

  test('the CLI parser catches a limit line sent with is_error false', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Claude AI usage limit reached|1793307600'
    })
    expect(parseClaudeCliOutput(stdout, '', null, [], NOW)).toMatchObject({
      ok: false,
      reason: 'limit',
      limit: { kind: 'session', resetsAt: new Date(1793307600 * 1000) }
    })
  })

  test('the CLI parser reads limit and account failures from stderr and stdout text', () => {
    expect(
      parseClaudeCliOutput(
        '',
        "You've hit your session limit · resets 7:30pm (America/Toronto)",
        null,
        [],
        NOW
      )
    ).toMatchObject({ ok: false, reason: 'limit', limit: { kind: 'session' } })
    expect(parseClaudeCliOutput('Credit balance is too low', '', null, [], NOW)).toMatchObject({
      ok: false,
      reason: 'credit_low'
    })
    expect(
      parseClaudeCliOutput('', 'Not logged in · Please run /login', null, [], NOW)
    ).toMatchObject({
      ok: false,
      reason: 'logged_out'
    })
  })
})
