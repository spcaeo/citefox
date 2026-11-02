import { afterEach, describe, expect, test } from 'vitest'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { cleanupHarness, harness } from './test-harness'

/**
 * Feedback batch 2 rows 3 and 5: competitors come from a web search per product; every
 * domain is checked (DNS, then a brand-name check) before it is shown, a domain the user
 * types is checked the same way, and reasons carry no notes about the search.
 */

afterEach(cleanupHarness)

describe('competitor domain lookup (fake Claude, fake DNS)', () => {
  test('fill from a website asks per product with web search, verifies domains and drops notes (batch 2 row 5)', async () => {
    const claude = scriptedClaude((prompt) => {
      if (prompt.startsWith('Assist: project.fillSiteRead')) {
        return {
          summary: 'TextBolt sells an email-to-text gateway.',
          brands: [{ name: 'TextBolt', reason: 'The home page names it.' }],
          products: [
            { name: 'Email-to-SMS gateway', job: 'Emails become texts.', buyer: 'US teams' }
          ],
          comparedWith: ['Text-Em-All'],
          suggestedMarket: null
        }
      }
      if (prompt.startsWith('Assist: project.fillSwitching')) {
        return {
          switchingFrom: [
            {
              name: 'AT&T email-to-text',
              domain: null,
              reason: 'It shut down.',
              evidence: { path: '/compare', quote: 'AT&T email-to-text shut down.' }
            }
          ],
          integrations: []
        }
      }
      if (prompt.startsWith('Assist: project.productCompetitors')) {
        return {
          direct: [
            {
              name: 'Text-Em-All',
              domain: 'https://www.textemall.com/',
              why: 'Sends mass texts to staff. The sources I found don’t say whether replies come back to email.',
              startingPrice: '$0.06/text',
              sources: [
                { url: 'https://textemall.com/pricing', biased: true },
                { url: 'https://textbolt.com/compare', biased: false },
                { url: 'ftp://files.example/list', biased: false }
              ]
            },
            { name: 'TextBolt', domain: 'textbolt.com', why: 'Itself.', startingPrice: null },
            { name: 'AT&T email-to-text', domain: 'att.com', why: 'The old gateway.' }
          ],
          partial: [
            { name: 'Ghost Texts', domain: 'ghosttexts.example', why: 'Sold to the same teams.' }
          ]
        }
      }
      return null
    })
    const { handlers } = harness({
      claude,
      pageDns: fakeDns(['textemall.com']),
      readWebsitePage: async (url) =>
        url.endsWith('/compare')
          ? { title: 'Compare', text: 'Text-Em-All vs TextBolt. AT&T email-to-text shut down.' }
          : /(?:pricing|about)$/u.test(url)
            ? { title: 'Plans', text: 'Plans for small teams. About the team.' }
            : null
    })
    const result = await handlers['projects:fillFromWebsite']({
      projectId: null,
      domain: 'textbolt.com',
      market: { country: 'CA', language: 'fr' }
    })
    const product = result.products?.[0]
    expect(product).toMatchObject({ name: 'Email-to-SMS gateway', searchNote: null })
    expect(
      result.competitors.map((item) => [
        item.name,
        item.domain,
        item.domainSource,
        item.tier,
        item.checkDomain
      ])
    ).toEqual([
      ['Text-Em-All', 'textemall.com', 'search', 'direct', false],
      // Its domain does not resolve: never shown, the user can type it.
      ['Ghost Texts', null, null, 'partial', true]
    ])
    const rival = result.competitors[0]
    expect(rival?.product).toBe(product?.id)
    expect(rival?.reason).toBe('Sends mass texts to staff.')
    expect(rival?.startingPrice).toBe('$0.06/text')
    // Its own pricing page is the source for its own price; the business's page is marketing.
    expect(rival?.sources).toEqual([
      { url: 'https://textemall.com/pricing', biased: false },
      { url: 'https://textbolt.com/compare', biased: true }
    ])
    expect(result.switchingFrom.map((item) => item.name)).toEqual(['AT&T email-to-text'])
    const ask = claude.requests.find((request) =>
      request.prompt.startsWith('Assist: project.productCompetitors')
    )
    expect(ask?.webSearch).toBe(true)
    expect(ask?.prompt).toContain('for buyers in Canada (French)')
    expect(ask?.prompt).toContain('Its own pages compare it with: Text-Em-All.')
    expect(ask?.prompt).not.toContain('No new searches were made')
    // The two page steps never get web search.
    expect(
      claude.requests
        .filter((request) => request.webSearch === true)
        .map((request) => request.prompt.split(NEWLINE)[0])
    ).toEqual(['Assist: project.productCompetitors'])
  })

  test('a failed competitor search keeps the product with a plain note', async () => {
    const claude = scriptedClaude((prompt) =>
      prompt.startsWith('Assist: project.fillSiteRead')
        ? {
            summary: null,
            brands: [{ name: 'TextBolt', reason: 'The home page names it.' }],
            products: [{ name: 'Gateway', job: 'Emails become texts.', buyer: 'Teams' }],
            suggestedMarket: null
          }
        : prompt.startsWith('Assist: project.fillSwitching')
          ? { switchingFrom: [], integrations: [] }
          : { wrong: true }
    )
    const { handlers } = harness({
      claude,
      readWebsitePage: async () => ({ title: 'Home', text: 'Emails become texts.' })
    })
    const result = await handlers['projects:fillFromWebsite']({
      projectId: null,
      domain: 'textbolt.com'
    })
    expect(result.competitors).toEqual([])
    expect(result.products?.[0]?.searchNote).toContain('did not finish')
    expect(result.nextStep).toBeNull()
  })

  test('checkCompanyDomain checks a typed domain: hostname first, then DNS', async () => {
    const { handlers } = harness({ pageDns: fakeDns(['simpletexting.com']) })
    expect(
      await handlers['projects:checkCompanyDomain']({ domain: 'https://www.SimpleTexting.com/x' })
    ).toEqual({ ok: true, domain: 'simpletexting.com', message: 'simpletexting.com found.' })
    expect(await handlers['projects:checkCompanyDomain']({ domain: 'not a domain' })).toMatchObject(
      {
        ok: false,
        domain: null,
        message: 'Enter a domain such as example.com.'
      }
    )
    expect(await handlers['projects:checkCompanyDomain']({ domain: 'nope.example' })).toMatchObject(
      { ok: false, domain: null }
    )
  })
})

const NEWLINE = String.fromCharCode(10)

function scriptedClaude(
  reply: (prompt: string) => unknown
): ClaudeProvider & { requests: ClaudeCompletionRequest[] } {
  const requests: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    requests,
    async complete(request): Promise<ClaudeCompletion> {
      requests.push(request)
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

/** Fake DNS: only these names resolve (to a public address). */
function fakeDns(names: readonly string[]): { lookup: (hostname: string) => Promise<string[]> } {
  return {
    async lookup(hostname) {
      if (!names.includes(hostname)) throw new Error('ENOTFOUND')
      return ['93.184.216.34']
    }
  }
}
