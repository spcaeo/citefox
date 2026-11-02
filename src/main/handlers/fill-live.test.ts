import { afterEach, describe, expect, test } from 'vitest'
import type {
  FillFromWebsiteProgress,
  FillSearchFound,
  FillSiteFound,
  ProductCompetitorsRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import type { ClaudeCompletion, ClaudeProvider } from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import { cleanupHarness, harness } from './test-harness'

/**
 * Owner, 2026-10-29: setup step 3 shows what the read finds as it arrives. Fill from my
 * website pushes the site read (with the product ids competitors point at) before any
 * search starts, then each product's search: waiting its turn, searching (once the Claude
 * gate lets it start), done with its checked competitors, or failed with a plain note.
 * `projects:searchProductCompetitors` asks one product again.
 */

afterEach(cleanupHarness)

const SITE = {
  summary: 'TextBolt sells an email-to-text gateway.',
  brands: [{ name: 'TextBolt', reason: 'The home page names it.' }],
  products: [
    { name: 'Email-to-SMS gateway', job: 'Emails become texts.', buyer: 'US teams' },
    { name: 'On-call alerts', job: 'Alarm emails become texts.', buyer: 'IT teams' }
  ],
  comparedWith: ['Text-Em-All'],
  suggestedMarket: null
}

const RIVALS = {
  direct: [
    { name: 'Text-Em-All', domain: 'textemall.com', why: 'Mass texts to staff.', sources: [] }
  ],
  partial: []
}

/**
 * Fake Claude: answers by assist id, calls `onStart` as the gate would, and fails the
 * search for any product named in `fail` the way a timed-out `claude -p` does.
 */
function claudeFor(fail: readonly string[] = []): ClaudeProvider & { started: string[] } {
  const started: string[] = []
  return {
    id: 'claude-code',
    started,
    async complete(request): Promise<ClaudeCompletion> {
      request.onStart?.()
      const prompt = request.prompt
      let json: unknown = null
      if (prompt.startsWith('Assist: project.fillSiteRead')) json = SITE
      else if (prompt.startsWith('Assist: project.fillSwitching')) {
        json = { switchingFrom: [], integrations: [] }
      } else if (prompt.startsWith('Assist: project.productCompetitors')) {
        const product = /textbolt\.com's (.+?) that do exactly/u.exec(prompt)?.[1] ?? ''
        started.push(product)
        if (fail.includes(product)) throw new Error('Claude Code timed out after 180000 ms')
        json = RIVALS
      }
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 5,
        model: 'claude-sonnet',
        resolvedModel: 'claude-sonnet',
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

const DNS = {
  async lookup(hostname: string): Promise<string[]> {
    if (hostname !== 'textemall.com') throw new Error('ENOTFOUND')
    return ['93.184.216.34']
  }
}

function fillHarness(fail: readonly string[] = []): {
  handlers: ReturnType<typeof harness>['handlers']
  events: FillFromWebsiteProgress[]
  claude: ReturnType<typeof claudeFor>
} {
  const events: FillFromWebsiteProgress[] = []
  const claude = claudeFor(fail)
  const { handlers } = harness({
    claude,
    pageDns: DNS,
    emitFillProgress: (event) => events.push(event),
    readWebsitePage: async (url) =>
      url === 'https://textbolt.com/'
        ? { title: 'Home', text: 'Email to text. Text-Em-All vs TextBolt.' }
        : /(?:pricing|about)$/u.test(url)
          ? { title: 'Plans', text: 'Plans for small teams. About the team.' }
          : null
  })
  return { handlers, events, claude }
}

const sites = (events: readonly FillFromWebsiteProgress[]): FillSiteFound[] =>
  events.flatMap((event) => (event.found?.kind === 'site' ? [event.found] : []))
const searches = (events: readonly FillFromWebsiteProgress[]): FillSearchFound[] =>
  events.flatMap((event) => (event.found?.kind === 'search' ? [event.found] : []))

describe('Fill from my website: live finds for setup step 3', () => {
  test('pushes what the site sells first, then each product’s search as it goes', async () => {
    const { handlers, events } = fillHarness()
    const result = await handlers['projects:fillFromWebsite']({
      projectId: null,
      domain: 'textbolt.com',
      market: { country: 'US', language: 'en' }
    })
    const [site, ...more] = sites(events)
    expect(more).toEqual([])
    expect(site).toMatchObject({
      summary: 'TextBolt sells an email-to-text gateway.',
      comparedWith: ['Text-Em-All'],
      market: { country: 'US', language: 'en' }
    })
    // The ids on screen are the ids of the answer, so late competitors land under them.
    expect(site?.products.map((product) => product.id)).toEqual(
      result.products?.map((product) => product.id)
    )
    expect(site?.brands).toEqual(result.brands)
    const first = events.findIndex((event) => event.found?.kind === 'search')
    expect(events.findIndex((event) => event.found?.kind === 'site')).toBeLessThan(first)
    const [one, two] = site?.products ?? []
    const lines = searches(events).map((event) => [
      event.productId,
      event.state,
      event.competitors.map((row) => row.name)
    ])
    expect(lines.filter(([id]) => id === one?.id)).toEqual([
      [one?.id, 'waiting', []],
      [one?.id, 'running', []],
      [one?.id, 'done', ['Text-Em-All']]
    ])
    expect(lines.filter(([id]) => id === two?.id).map(([, state]) => state)).toEqual([
      'waiting',
      'running',
      'done'
    ])
    // A search's competitors are already checked (domain verified) when it says done.
    const done = searches(events).find((event) => event.state === 'done')
    expect(done?.competitors[0]).toMatchObject({
      domain: 'textemall.com',
      domainSource: 'search',
      product: one?.id
    })
    // Every live event is a `suggest` step, and none carries a prompt.
    for (const event of events.filter((item) => item.found !== undefined)) {
      expect(event.phase).toBe('suggest')
      expect(JSON.stringify(event)).not.toContain('Assist:')
    }
  })

  test('a search that times out says so on its line; the other product keeps its competitors', async () => {
    const { handlers, events } = fillHarness(['On-call alerts'])
    const result = await handlers['projects:fillFromWebsite']({
      projectId: null,
      domain: 'textbolt.com'
    })
    const failed = searches(events).filter((event) => event.state === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      note: 'It took too long and was stopped.',
      competitors: []
    })
    const product = result.products?.find((item) => item.id === failed[0]?.productId)
    expect(product?.name).toBe('On-call alerts')
    expect(product?.searchNote).toMatch(/did not finish/)
    expect(result.competitors.map((row) => row.name)).toEqual(['Text-Em-All'])
  })

  test('a brand-only read sends no live finds', async () => {
    const { handlers, events, claude } = fillHarness()
    await handlers['projects:fillFromWebsite']({
      projectId: null,
      domain: 'textbolt.com',
      brandOnly: true
    })
    expect(events.some((event) => event.found !== undefined)).toBe(false)
    expect(claude.started).toEqual([])
  })
})

describe('projects:searchProductCompetitors (Try again for one product)', () => {
  const request: ProductCompetitorsRequest = {
    projectId: null,
    domain: 'textbolt.com',
    market: { country: 'US', language: 'en' },
    summary: 'TextBolt sells an email-to-text gateway.',
    product: { id: 'prod-7', name: 'On-call alerts', job: 'Alarm emails become texts.', buyer: '' },
    comparedWith: ['Text-Em-All'],
    brandNames: ['TextBolt'],
    notCompetitors: ['Gmail']
  }

  test('asks that one product again; its competitors keep the product id', async () => {
    const { handlers, events, claude } = fillHarness()
    const result = await handlers['projects:searchProductCompetitors'](request)
    expect(claude.started).toEqual(['On-call alerts'])
    expect(result).toMatchObject({ productId: 'prod-7', ok: true, note: null })
    expect(result.competitors.map((row) => [row.name, row.product, row.domain])).toEqual([
      ['Text-Em-All', 'prod-7', 'textemall.com']
    ])
    // The answer is the result; nothing is pushed on the read's channel.
    expect(events).toEqual([])
  })

  test('a search that does not finish again answers with a plain note, not an error', async () => {
    const { handlers } = fillHarness(['On-call alerts'])
    const result = await handlers['projects:searchProductCompetitors'](request)
    expect(result).toEqual({
      productId: 'prod-7',
      ok: false,
      competitors: [],
      note: 'It took too long and was stopped.'
    })
  })

  test('refuses a malformed request', async () => {
    const { handlers } = fillHarness()
    const bad = { ...request, product: { id: 'prod-7', name: '' } }
    await expect(
      handlers['projects:searchProductCompetitors'](bad as unknown as ProductCompetitorsRequest)
    ).rejects.toBeInstanceOf(IpcRequestError)
    await expect(
      handlers['projects:searchProductCompetitors']({
        ...request,
        comparedWith: Array.from({ length: 21 }, (_, index) => `Rival ${index}`)
      })
    ).rejects.toBeInstanceOf(IpcRequestError)
  })
})
