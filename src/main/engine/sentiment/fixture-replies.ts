import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recorded brand-sentiment fixtures for tests and the e2e seed: SerpApi bodies
 * for brand prompts and the replies Claude gives to the sentiment templates.
 * Not imported by production code. Plain Node, so Playwright seeds can use it.
 */
export const SENTIMENT_FIXTURES = join(process.cwd(), 'src/main/engine/sentiment/fixtures')

/** A brand fact that turns the pricing overview's problem into a fact problem. */
export const PRICING_FACT = 'TextBolt plans start at $29 a month.'

export function fixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(join(SENTIMENT_FIXTURES, name), 'utf8')) as unknown
}

/** A recorded SerpApi envelope as the HTTP transport returns it. */
export function serpBody(name: string): { status: number; body: string } {
  const parsed = fixtureJson(name) as { status: number; body: unknown }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

/** The reply Claude would give for a rendered prompt. */
export function sentimentReply(prompt: string): unknown {
  if (prompt.startsWith('Template: brand_prompts.md')) {
    return fixtureJson(
      prompt.includes('Spanish') ? 'claude-brand-prompts-es.json' : 'claude-brand-prompts.json'
    )
  }
  if (prompt.startsWith('Template: sentiment_claims_v2.md')) {
    if (prompt.includes('TextBolt pricing starts at $19')) {
      return fixtureJson('claude-sentiment-pricing.json')
    }
    if (prompt.includes('no-code email-to-SMS gateway')) {
      return fixtureJson('claude-sentiment-reviews.json')
    }
    return fixtureJson('claude-sentiment-none.json')
  }
  if (prompt.startsWith('Template: sentiment_fact_check.md')) {
    return fixtureJson(factCheckFixture(prompt))
  }
  throw new Error(`No fixture for prompt: ${prompt.slice(0, 80)}`)
}

/**
 * The recorded fact check for a rendered `sentiment_fact_check.md` prompt: the
 * pricing claim against the brand fact, else against the pricing page, else no
 * problem. The e2e Claude stand-in uses the same names.
 */
export function factCheckFixture(prompt: string): string {
  if (!prompt.includes('TextBolt pricing starts at $19')) return 'claude-sentiment-check-none.json'
  return prompt.includes(PRICING_FACT)
    ? 'claude-sentiment-check-facts.json'
    : 'claude-sentiment-check-pricing.json'
}

/** A tracked own page whose text the fact check quotes against the pricing claim. */
export const PRICING_PAGE_TEXT =
  'TextBolt plans start at $29 a month and include 500 texts. Every plan includes a free test alert before you pay. Setup takes about 30 minutes from Gmail or Outlook.'
