import { describe, expect, test } from 'vitest'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { ClaudeLimitError, ProviderError } from '../providers/errors'
import {
  CLAUDE_RETRY_LATER_MS,
  CLAUDE_WAIT_RETRY_MS,
  ClaudeHaltError,
  createProjectClaudeProvider,
  isProjectClaudeProvider,
  type FallbackNotice,
  type ProjectClaudeOptions
} from './claude-fallback'

function completion(text: string): ClaudeCompletion {
  return {
    provider: 'anthropic-api',
    text,
    json: null,
    inputTokens: 1,
    outputTokens: 1,
    durationMs: 5,
    model: 'claude-sonnet-5-5',
    resolvedModel: null,
    usage: emptyClaudeCliUsage()
  }
}

function provider(
  id: ClaudeProvider['id'],
  answer: () => Promise<ClaudeCompletion>
): ClaudeProvider & { calls: number } {
  const wrapped = {
    id,
    calls: 0,
    async complete(): Promise<ClaudeCompletion> {
      wrapped.calls += 1
      return answer()
    }
  }
  return wrapped
}

function limited(): Promise<ClaudeCompletion> {
  return Promise.reject(new ClaudeLimitError('Claude Code hit its usage limit.'))
}

function build(
  rule: ProjectClaudeOptions['rule'],
  primary: ClaudeProvider,
  fallback?: ClaudeProvider
): {
  claude: ReturnType<typeof createProjectClaudeProvider>
  notices: FallbackNotice[]
  calls: Array<string | null>
} {
  const notices: FallbackNotice[] = []
  const calls: Array<string | null> = []
  const claude = createProjectClaudeProvider({
    primary,
    primaryLabel: 'Claude Code',
    primaryKeyId: null,
    rule,
    projectName: 'TextBolt',
    fallback:
      fallback === undefined
        ? undefined
        : () => ({ provider: fallback, label: 'My key', keyId: 'key-mine' }),
    onCall: (keyId) => calls.push(keyId),
    onNotice: (notice) => notices.push(notice)
  })
  return { claude, notices, calls }
}

describe('project Claude fallback (FR-11.7, LLM-10)', () => {
  test('switch_key moves the call to the named key and records one notice', async () => {
    const primary = provider('claude-code', limited)
    const fallback = provider('anthropic-api', () => Promise.resolve(completion('from key')))
    const { claude, notices, calls } = build('switch_key', primary, fallback)
    expect((await claude.complete({ prompt: 'a' })).text).toBe('from key')
    expect((await claude.complete({ prompt: 'b' })).text).toBe('from key')
    expect(primary.calls).toBe(1)
    expect(fallback.calls).toBe(2)
    expect(calls).toEqual([null, 'key-mine', 'key-mine'])
    expect(notices).toEqual([
      {
        kind: 'claude_fallback',
        keyId: 'key-mine',
        sentence:
          'Claude Code hit its usage limit for TextBolt. CiteFox switched to "My key", and nothing failed.'
      }
    ])
    expect(claude.halt()).toBeNull()
  })

  test('switch_key without a usable key rethrows the original error', async () => {
    const primary = provider('claude-code', limited)
    const notices: FallbackNotice[] = []
    const claude = createProjectClaudeProvider({
      primary,
      primaryLabel: 'Claude Code',
      primaryKeyId: null,
      rule: 'switch_key',
      projectName: null,
      fallback: () => null,
      onNotice: (notice) => notices.push(notice)
    })
    await expect(claude.complete({ prompt: 'a' })).rejects.toBeInstanceOf(ClaudeLimitError)
    expect(notices).toEqual([])
  })

  test('wait keeps the plan-limit words, halts, and stops later calls at once', async () => {
    const primary = provider('claude-code', limited)
    const { claude, notices } = build('wait', primary)
    const error = await claude.complete({ prompt: 'a' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ClaudeHaltError)
    const halted = error as ClaudeHaltError
    expect(halted.message).toBe('Claude Code hit its usage limit.')
    expect(halted.nextStep).toContain('Wait for the plan limit to reset')
    expect(halted.code).toBe('plan_limit')
    expect(claude.halt()).toMatchObject({ rule: 'wait', retryAfterMs: CLAUDE_WAIT_RETRY_MS })
    await expect(claude.complete({ prompt: 'b' })).rejects.toBe(halted)
    expect(primary.calls).toBe(1)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'claude_limit', keyId: null })
    expect(notices[0]?.sentence).toContain('searches already made are kept')
  })

  test('retry_later and ask say what happens next', async () => {
    const failing = (): Promise<ClaudeCompletion> =>
      Promise.reject(
        new ProviderError('Claude Code is not installed.', {
          code: 'not_installed',
          state: 'warning',
          nextStep: 'Install it.'
        })
      )
    const later = build('retry_later', provider('claude-code', failing))
    const laterError = (await later.claude
      .complete({ prompt: 'a' })
      .catch((caught: unknown) => caught)) as ClaudeHaltError
    expect(laterError.message).toBe(
      "Claude Code isn't installed on this computer (TextBolt). CiteFox will try again in 15 minutes; searches already made are kept."
    )
    expect(later.claude.halt()).toMatchObject({
      rule: 'retry_later',
      retryAfterMs: CLAUDE_RETRY_LATER_MS
    })

    const ask = build('ask', provider('claude-code', limited))
    const askError = (await ask.claude
      .complete({ prompt: 'a' })
      .catch((caught: unknown) => caught)) as ClaudeHaltError
    expect(askError.message).toContain('CiteFox stopped and is waiting for you')
    expect(askError.nextStep).toContain('Project settings')
    expect(ask.claude.halt()).toMatchObject({ rule: 'ask', retryAfterMs: null })
  })

  test('wait on a missing Claude names the real reason, never a limit reset', async () => {
    const missing = (): Promise<ClaudeCompletion> =>
      Promise.reject(
        new ProviderError('Claude Code is not installed.', {
          code: 'not_installed',
          state: 'warning',
          nextStep: 'Install Claude Code, then check it in Connections.'
        })
      )
    const { claude, notices } = build('wait', provider('claude-code', missing))
    const error = (await claude
      .complete({ prompt: 'a' })
      .catch((caught: unknown) => caught)) as ClaudeHaltError
    expect(error.message).toBe('Claude Code is not installed.')
    expect(error.nextStep).toBe('Install Claude Code, then check it in Connections.')
    expect(notices[0]?.sentence).toBe(
      "Claude Code isn't installed on this computer (TextBolt). CiteFox will finish the analysis once it works; searches already made are kept."
    )
    expect(notices[0]?.sentence).not.toContain('limit')
  })

  test('a bad reply is not a connection failure and is rethrown untouched', async () => {
    const invalid = new ProviderError('The reply did not match the schema.', {
      code: 'validation',
      state: 'warning',
      nextStep: 'Try again.'
    })
    const primary = provider('claude-code', () => Promise.reject(invalid))
    const fallback = provider('anthropic-api', () => Promise.resolve(completion('x')))
    const { claude, notices } = build('switch_key', primary, fallback)
    await expect(claude.complete({ prompt: 'a' })).rejects.toBe(invalid)
    expect(fallback.calls).toBe(0)
    expect(notices).toEqual([])
    const plain = build(
      'wait',
      provider('claude-code', () => Promise.reject(new Error('boom')))
    )
    await expect(plain.claude.complete({ prompt: 'a' })).rejects.toThrow('boom')
    expect(plain.claude.halt()).toBeNull()
  })

  test('is recognised as a project provider', () => {
    const { claude } = build('wait', provider('claude-code', limited))
    expect(isProjectClaudeProvider(claude)).toBe(true)
    expect(isProjectClaudeProvider(provider('claude-code', limited))).toBe(false)
  })
})
