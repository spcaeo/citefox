import type { CheckProgress } from '@shared/ipc'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../../providers/claude/parse'
import { insertBrandPromptSet } from '../../storage/brand-records'
import { addPageMarket, insertPage } from '../../storage/pages'
import { insertMarket } from '../../storage/project-profile'
import { insertSnapshot } from '../../storage/content-records'
import { envelope, NOW, page, seed, snapshot } from '../checks/checks.test-helper'
import { PRICING_FACT, PRICING_PAGE_TEXT, sentimentReply, serpBody } from './fixture-replies'

export { PRICING_FACT }

/** What `seedSentiment` returns. */
export type SentimentSeed = Awaited<ReturnType<typeof seed>>

/**
 * SerpApi stand-in for the brand-sentiment tests. `queries` records every
 * Google search's `q`. "TextBolt reviews", "TextBolt opiniones" and "TextBolt
 * pricing" return overviews that name the brand; every other brand prompt has
 * no overview. Buyer prompts use the shared overview, which names no brand.
 */
export function sentimentHttp(queries: string[] = []): (request: HttpRequest) => HttpResponse {
  return (request) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    queries.push(q)
    if (q === 'TextBolt reviews') return serpBody('serp-brand-reviews.json')
    if (q === 'TextBolt pricing') return serpBody('serp-brand-pricing.json')
    if (q === 'TextBolt opiniones') return serpBody('serp-brand-reviews.json')
    if (q.includes('TextBolt')) return envelope('google-no-aio.json')
    return envelope('google-ai-overview.json')
  }
}

/** A Claude provider that answers from the recorded replies and records each prompt. */
export function fixtureClaude(
  seen: string[] = [],
  options: { fail?: () => boolean } = {}
): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request) {
      seen.push(request.prompt)
      if (options.fail?.() === true) throw new Error('Claude Code is logged out.')
      const json = sentimentReply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 3,
        outputTokens: 2,
        durationMs: 1,
        model: 'fixture',
        resolvedModel: 'fixture',
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

/**
 * The check-engine fixture project (one page, US · EN) plus MX · ES, five
 * English and two Spanish brand prompts saved for the page.
 */
export async function seedSentiment(input: {
  queries?: string[]
  claude?: ClaudeProvider
  brandPrompts?: boolean
}): Promise<Awaited<ReturnType<typeof seed>>> {
  const progress: CheckProgress[] = []
  const seeded = await seed({
    progress,
    http: sentimentHttp(input.queries),
    ...(input.claude !== undefined ? { claude: input.claude } : {})
  })
  // The pricing page: own page text the fact check quotes against the pricing claim.
  insertPage(seeded.projectDb, {
    ...page(),
    id: 'page-pricing',
    url: 'https://textbolt.com/pricing/',
    title: 'Pricing',
    label: 'Pricing',
    status: 'paused'
  })
  insertSnapshot(seeded.projectDb, {
    ...snapshot(),
    id: 'snap-pricing',
    pageId: 'page-pricing',
    title: 'TextBolt pricing',
    bodyText: PRICING_PAGE_TEXT
  })
  insertMarket(seeded.projectDb, {
    id: 'mkt-mx',
    country: 'MX',
    language: 'es',
    location: null,
    device: 'mobile',
    localWording: false,
    serpapiLocation: null
  })
  addPageMarket(seeded.projectDb, {
    pageId: 'page-1',
    marketId: 'mkt-mx',
    addedAt: NOW,
    baselineRunId: null
  })
  if (input.brandPrompts !== false) {
    insertBrandPromptSet(seeded.projectDb, {
      pageId: 'page-1',
      savedAt: NOW,
      templateId: null,
      templateHash: null,
      prompts: [
        { id: 'bp-review', kind: 'review', language: 'en', text: 'TextBolt reviews' },
        { id: 'bp-pricing', kind: 'pricing', language: 'en', text: 'TextBolt pricing' },
        { id: 'bp-alt', kind: 'alternatives', language: 'en', text: 'TextBolt alternatives' },
        {
          id: 'bp-vs',
          kind: 'comparison',
          language: 'en',
          text: 'TextBolt vs SimpleTexting for staff alerts'
        },
        {
          id: 'bp-use',
          kind: 'use_case',
          language: 'en',
          text: 'Is TextBolt good for staff alerts from Outlook'
        },
        { id: 'bp-es-review', kind: 'review', language: 'es', text: 'TextBolt opiniones' },
        { id: 'bp-es-price', kind: 'pricing', language: 'es', text: 'TextBolt precios' }
      ]
    })
  }
  return seeded
}
