import { describe, expect, test } from 'vitest'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { codexFailure } from '../providers/codex/errors'
import {
  CLAUDE_RETRY_LATER_MS,
  CLAUDE_WAIT_RETRY_MS,
  ClaudeHaltError,
  createProjectClaudeProvider,
  type FallbackNotice,
  type ProjectClaudeOptions
} from './claude-fallback'

const NOW = new Date(2026, 9, 29, 9, 0)

function codex(error: Error): ClaudeProvider & { calls: number } {
  const wrapped = {
    id: 'codex' as const,
    calls: 0,
    async complete(): Promise<ClaudeCompletion> {
      wrapped.calls += 1
      throw error
    }
  }
  return wrapped
}

function build(
  rule: ProjectClaudeOptions['rule'],
  primary: ClaudeProvider
): { claude: ReturnType<typeof createProjectClaudeProvider>; notices: FallbackNotice[] } {
  const notices: FallbackNotice[] = []
  const claude = createProjectClaudeProvider({
    primary,
    primaryLabel: 'Codex',
    primaryKeyId: null,
    rule,
    projectName: 'TextBolt',
    onCall: () => undefined,
    onNotice: (notice) => notices.push(notice)
  })
  return { claude, notices }
}

const failure = (reason: 'limit' | 'logged_out'): Error =>
  codexFailure(
    { ok: false, reason, detail: '', usage: null, resetsAt: new Date(2026, 9, 29, 15, 45) },
    null,
    'gpt-5.6-terra',
    [],
    NOW
  )

describe('project fallback rules with Codex', () => {
  test('wait: a Codex usage limit halts and stops later calls, in Codex words', async () => {
    const primary = codex(failure('limit'))
    const { claude, notices } = build('wait', primary)
    const error = (await claude
      .complete({ prompt: 'a' })
      .catch((caught: unknown) => caught)) as ClaudeHaltError
    expect(error).toBeInstanceOf(ClaudeHaltError)
    expect(error.code).toBe('plan_limit')
    expect(error.message).toContain('Codex hit your ChatGPT usage limit')
    expect(claude.halt()).toMatchObject({ rule: 'wait', retryAfterMs: CLAUDE_WAIT_RETRY_MS })
    await expect(claude.complete({ prompt: 'b' })).rejects.toBe(error)
    expect(primary.calls).toBe(1)
    expect(notices[0]?.sentence).toContain('Codex')
    expect(notices[0]?.sentence).not.toMatch(/claude/i)
  })

  test('retry_later and ask: a signed-out Codex names Codex, never Claude', async () => {
    const later = build('retry_later', codex(failure('logged_out')))
    const laterError = (await later.claude
      .complete({ prompt: 'a' })
      .catch((caught: unknown) => caught)) as ClaudeHaltError
    expect(later.claude.halt()).toMatchObject({
      rule: 'retry_later',
      retryAfterMs: CLAUDE_RETRY_LATER_MS
    })
    expect(laterError.message).toContain('Codex')
    expect(`${laterError.message} ${later.notices[0]?.sentence ?? ''}`).not.toMatch(/claude/i)

    const ask = build('ask', codex(failure('limit')))
    const askError = (await ask.claude
      .complete({ prompt: 'a' })
      .catch((caught: unknown) => caught)) as ClaudeHaltError
    expect(askError.message).toContain('CiteFox stopped and is waiting for you')
    expect(ask.claude.halt()).toMatchObject({ rule: 'ask', retryAfterMs: null })
  })
})
