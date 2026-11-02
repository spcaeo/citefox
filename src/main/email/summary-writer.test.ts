import { describe, expect, it } from 'vitest'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import { claudeSummaryWriter } from './summary-writer'

function fakeClaude(text: string, seen: ClaudeCompletionRequest[]): ClaudeProvider {
  return {
    id: 'claude-code',
    complete: async (request) => {
      seen.push(request)
      return {
        provider: 'claude-code',
        text,
        json: null,
        inputTokens: null,
        outputTokens: null,
        durationMs: 1,
        model: null
      } as Awaited<ReturnType<ClaudeProvider['complete']>>
    }
  }
}

describe('scheduled report summary writer', () => {
  it('asks Claude to rewrite the report facts, client-friendly when asked', async () => {
    const seen: ClaudeCompletionRequest[] = []
    const writer = claudeSummaryWriter(() => fakeClaude('  Harbor is cited in 3 of 10.  ', seen))
    const text = await writer.write({
      style: 'client_friendly',
      facts: 'Visibility score 42. Cited in 3 of 10 prompts.'
    })
    expect(text).toBe('Harbor is cited in 3 of 10.')
    expect(seen[0]?.prompt).toContain('Visibility score 42. Cited in 3 of 10 prompts.')
    expect(seen[0]?.prompt).toMatch(/no jargon/i)
    expect(seen[0]?.prompt).toContain('Write notes, not essays')
    expect(seen[0]?.prompt).toContain('write "unknown" instead of guessing')
    expect(seen[0]?.prompt).toContain('Keep observations and proposals apart')
    expect(seen[0]?.trace).toMatchObject({ source: 'report' })
  })

  it('keeps the facts as written when the rewrite quotes a number they do not hold', async () => {
    const facts =
      'Google cites you in 3 of 10 answers.\n\nWhat to do next:\n1. Answer the pricing question.'
    const invented = claudeSummaryWriter(() =>
      fakeClaude('You are cited in 3 of 10 answers, about 30% of them.', [])
    )
    expect(await invented.write({ style: 'standard', facts })).toBe(facts)
    const faithful = claudeSummaryWriter(() =>
      fakeClaude('Google cites you in 3 of 10 answers.\n1. Answer the pricing question.', [])
    )
    expect(await faithful.write({ style: 'standard', facts })).toBe(
      'Google cites you in 3 of 10 answers.\n1. Answer the pricing question.'
    )
  })

  it('fails when Claude is not set up or answers nothing, so the send is recorded as failed', async () => {
    await expect(
      claudeSummaryWriter(() => undefined).write({ style: 'standard', facts: 'x' })
    ).rejects.toThrow()
    await expect(
      claudeSummaryWriter(() => fakeClaude('   ', [])).write({ style: 'standard', facts: 'x' })
    ).rejects.toThrow()
  })
})
