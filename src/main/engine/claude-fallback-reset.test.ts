import { describe, expect, test } from 'vitest'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { ClaudeLimitInfo } from '../providers/claude/limits'
import { CLAUDE_PAUSE_MARGIN_MS } from '../providers/claude/shared-gate'
import { ClaudeLimitError, ProviderError } from '../providers/errors'
import {
  CLAUDE_RETRY_LATER_MS,
  CLAUDE_WAIT_RETRY_MS,
  createProjectClaudeProvider,
  type FallbackNotice,
  type ProjectClaudeOptions
} from './claude-fallback'

const NOW = new Date('2026-10-29T18:00:00Z')

function failing(error: ProviderError): ClaudeProvider & { calls: number } {
  const provider = {
    id: 'claude-code' as const,
    calls: 0,
    complete(): Promise<never> {
      provider.calls += 1
      return Promise.reject(error)
    }
  }
  return provider
}

function limitError(limit: ClaudeLimitInfo): ClaudeLimitError {
  return new ClaudeLimitError("You've reached your weekly Claude usage limit.", [], limit)
}

async function haltOf(
  rule: ProjectClaudeOptions['rule'],
  error: ProviderError
): Promise<{
  halt: ReturnType<ReturnType<typeof createProjectClaudeProvider>['halt']>
  notices: FallbackNotice[]
  thrown: unknown
  primary: ReturnType<typeof failing>
  claude: ReturnType<typeof createProjectClaudeProvider>
}> {
  const notices: FallbackNotice[] = []
  const primary = failing(error)
  const claude = createProjectClaudeProvider({
    primary,
    primaryLabel: 'Claude Code',
    primaryKeyId: null,
    rule,
    projectName: 'TextBolt',
    onNotice: (notice) => notices.push(notice),
    now: () => NOW
  })
  const thrown = await claude.complete({ prompt: 'a' }).catch((caught: unknown) => caught)
  return { halt: claude.halt(), notices, thrown, primary, claude }
}

describe('the fallback waits until Claude says the limit resets', () => {
  test('wait: a weekly limit days away waits until then, and says the day', async () => {
    const resetsAt = new Date('2026-11-02T14:00:00Z')
    const { halt, notices, thrown, primary, claude } = await haltOf(
      'wait',
      limitError({ kind: 'weekly', resetsAt })
    )
    expect(halt?.retryAfterMs).toBe(resetsAt.getTime() - NOW.getTime() + CLAUDE_PAUSE_MARGIN_MS)
    expect(halt?.message).toMatch(
      /^Claude Code hit its weekly usage limit for TextBolt\. It resets \w+, Nov 2 at .+, and CiteFox will finish the analysis then; searches already made are kept\.$/
    )
    expect(notices).toHaveLength(1)
    // The person reads the limit words, and the reset time travels with the error.
    expect(thrown).toMatchObject({ code: 'plan_limit', limit: { kind: 'weekly', resetsAt } })
    // Work stops: later calls do not reach Claude again.
    await expect(claude.complete({ prompt: 'b' })).rejects.toMatchObject({ code: 'plan_limit' })
    expect(primary.calls).toBe(1)
  })

  test('wait: a session limit later today waits until it resets', async () => {
    const resetsAt = new Date('2026-10-29T23:30:00Z')
    const { halt } = await haltOf('wait', limitError({ kind: 'session', resetsAt }))
    expect(halt?.retryAfterMs).toBe(5.5 * 60 * 60_000 + CLAUDE_PAUSE_MARGIN_MS)
    expect(halt?.message).toMatch(/hit its 5-hour usage limit for TextBolt\. It resets/)
  })

  test('wait: no reset time keeps the hour wait', async () => {
    const { halt } = await haltOf('wait', limitError({ kind: 'unknown', resetsAt: null }))
    expect(halt?.retryAfterMs).toBe(CLAUDE_WAIT_RETRY_MS)
    expect(halt?.message).toMatch(/after the limit resets/)
  })

  test('wait: a reset time already past still waits a minute, not zero', async () => {
    const { halt } = await haltOf(
      'wait',
      limitError({ kind: 'session', resetsAt: new Date(NOW.getTime() - 10 * 60_000) })
    )
    expect(halt?.retryAfterMs).toBe(60_000)
  })

  test('retry_later: does not retry every 15 minutes before a known reset', async () => {
    const resetsAt = new Date('2026-10-30T13:00:00Z')
    const { halt } = await haltOf('retry_later', limitError({ kind: 'session', resetsAt }))
    expect(halt?.retryAfterMs).toBe(resetsAt.getTime() - NOW.getTime() + CLAUDE_PAUSE_MARGIN_MS)
    expect(halt?.message).toMatch(/It resets .+, and CiteFox will try again then/)
  })

  test('retry_later: a reset within 15 minutes keeps the 15-minute retry', async () => {
    const { halt } = await haltOf(
      'retry_later',
      limitError({ kind: 'session', resetsAt: new Date(NOW.getTime() + 5 * 60_000) })
    )
    expect(halt?.retryAfterMs).toBe(CLAUDE_RETRY_LATER_MS)
  })

  test('ask: stops and says when the limit resets', async () => {
    const { halt } = await haltOf(
      'ask',
      limitError({ kind: 'weekly', resetsAt: new Date('2026-11-02T14:00:00Z') })
    )
    expect(halt?.retryAfterMs).toBeNull()
    expect(halt?.message).toMatch(/\(it resets \w+, Nov 2 at .+\)\. CiteFox stopped and is waiting/)
  })

  test.each([
    [
      'logged_out',
      /^Claude Code is signed out \(TextBolt\)\. CiteFox will finish the analysis once it works/
    ],
    ['plan_inactive', /^Claude Code's Claude subscription is not active \(TextBolt\)/],
    ['credit_low', /^Claude Code has run out of credit \(TextBolt\)/]
  ] as const)('%s is never called a limit', async (code, message) => {
    const { halt } = await haltOf(
      'wait',
      new ProviderError('stopped', { code, state: 'warning', nextStep: null })
    )
    expect(halt?.message).toMatch(message)
    expect(halt?.message).not.toMatch(/limit/)
    expect(halt?.retryAfterMs).toBe(CLAUDE_WAIT_RETRY_MS)
  })
})
