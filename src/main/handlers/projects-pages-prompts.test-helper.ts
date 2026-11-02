import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import {
  TEXTBOLT_PROFILE,
  TEXTBOLT_PROMPTS_EN,
  TEXTBOLT_PROMPTS_ES
} from '../pipeline/textbolt-fixture'

/** Scripted Claude replies for the M2 IPC handler tests, by prompt. */
export function route(prompt: string): unknown {
  if (prompt.startsWith('Assist: page.shorterTitle')) {
    const item = (text: string): Record<string, unknown> => ({
      text,
      detail: null,
      tag: null,
      verify: null,
      sign: null
    })
    return {
      summary: null,
      items: [
        item('Saturday text alerts'),
        item('Text the weekend crew'),
        item('Alerts, no new app')
      ],
      caution: null
    }
  }
  if (prompt.startsWith('Assist: page.promises')) {
    const item = (tag: string): Record<string, unknown> => ({
      text: `The ${tag} promises Saturday shift texts.`,
      detail: tag === 'h1' ? null : `Line ${tag}`,
      tag,
      verify: null,
      sign: null
    })
    return { summary: null, items: [item('title'), item('meta'), item('h1')], caution: null }
  }
  if (prompt.startsWith('Assist: page.checkFacts')) {
    return { summary: 'Nothing to re-check.', items: [], caution: null }
  }
  if (prompt.startsWith('Assist: project.fillSiteRead')) {
    return {
      summary: 'TextBolt sells email to text for small crews.',
      brands: [{ name: 'TextBolt', reason: 'The home page names it.' }],
      products: [
        {
          name: 'Email-to-SMS gateway',
          job: 'Turns emails into texts.',
          buyer: 'Small crews',
          evidence: { path: '/', quote: 'Email to text for a small crew.' }
        }
      ],
      suggestedMarket: {
        country: 'US',
        language: 'en',
        location: null,
        reason: 'The page is US English.'
      }
    }
  }
  if (prompt.startsWith('Assist: project.fillSwitching')) {
    return { switchingFrom: [], integrations: [] }
  }
  if (prompt.startsWith('Assist: project.productCompetitors')) {
    return {
      direct: [],
      partial: [
        {
          name: 'Twilio',
          domain: 'twilio.com',
          why: 'A developer API.',
          startingPrice: null,
          sources: [{ url: 'https://www.twilio.com/en-us/sms', biased: true }]
        }
      ]
    }
  }
  if (prompt.includes('Write six parts')) return TEXTBOLT_PROFILE
  if (prompt.includes('Market language: es')) return TEXTBOLT_PROMPTS_ES
  return TEXTBOLT_PROMPTS_EN
}

export function scriptedClaude(
  reply: (prompt: string) => unknown
): ClaudeProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    id: 'claude-code',
    calls,
    async complete(request): Promise<ClaudeCompletion> {
      calls.push(request.prompt)
      const json = reply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 11,
        outputTokens: 22,
        durationMs: 8,
        model: 'claude-sonnet',
        resolvedModel: 'claude-sonnet',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 101, outputTokens: 55 }
      }
    }
  }
}
